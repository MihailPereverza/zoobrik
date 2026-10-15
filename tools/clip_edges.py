"""Whether a movie clip cuts its line short: playphrase.me cuts a clip at the subtitle's edges, and speech often runs
past them (the end of «on Friday», the «I can-» of «I cannot wear these»). Nothing beyond the cut can be fetched, so
such a clip is rejected and the next candidate taken.

Whisper hears the clip twice, with and without half a second of silence before it (always after), and its words are lined up with the subtitle's:
- subtitle words before the first matching word that Whisper did not hear (as a word of its own or misheard) were cut
  off at the start; the same after the last matching word at the end;
- the line's last word said right at the cut and heard with low confidence is clipped mid-sound.
What Whisper heard is cached by file content in tools/.cache/playphrase/edges.json.
"""

import hashlib
import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

CACHE = Path(__file__).resolve().parent / '.cache' / 'playphrase' / 'edges.json'
WHISPER_MODEL = 'mlx-community/whisper-large-v3-turbo'
PAD_SECONDS = 0.5
# Silence before the clip in each hearing.
LEADS = (PAD_SECONDS, 0.0)
# A word Whisper places this close to the cut and is unsure of has lost part of its sound.
NEAR_CUT_SECONDS = 0.12
MIN_PROBABILITY = 0.85
SPELLINGS = {'alright': 'all right', 'ok': 'okay', 'everything’s': 'everything is', 'gonna': 'going to'}


@dataclass
class Edges:
    """What Whisper made of the clip's edges."""

    cut: str
    """Why the line is cut short (Russian, for the notes); empty when both edges are clean."""
    heard: str
    """What Whisper heard."""


def words_of(text: str) -> list[str]:
    lowered = text.lower().replace('’', "'")
    for spelling, plain in SPELLINGS.items():
        lowered = re.sub(rf'\b{re.escape(spelling)}\b', plain, lowered)
    return re.findall(r"[a-z0-9']+", lowered)


def transcribe(*, video: Path, lead: float) -> dict[str, Any]:
    # Imported here: only the edge check needs Whisper, and it loads for seconds.
    import mlx_whisper

    with tempfile.TemporaryDirectory() as scratch:
        wav = Path(scratch) / 'clip.wav'
        chain = f'adelay={int(lead * 1000)}:all=1,apad=pad_dur={PAD_SECONDS}'
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-vn', '-af', chain, '-ac', '1', '-ar', '16000',
                        str(wav)], check=True)
        return mlx_whisper.transcribe(str(wav), path_or_hf_repo=WHISPER_MODEL, word_timestamps=True, language='en',
                                      condition_on_previous_text=False, temperature=0.0)


def duration(video: Path) -> float:
    command = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(video)]
    return float(subprocess.run(command, capture_output=True, text=True, check=True).stdout)


def lost_words(*, said: list[str], heard: list[str]) -> tuple[int, int]:
    """Subtitle words missing before the first and after the last word Whisper heard as said."""
    blocks = [b for b in SequenceMatcher(a=said, b=heard, autojunk=False).get_matching_blocks() if b.size]
    if not blocks:
        return len(said), 0
    first, last = blocks[0], blocks[-1]
    after_said, after_heard = len(said) - last.a - last.size, len(heard) - last.b - last.size
    return max(0, first.a - first.b), max(0, after_said - after_heard)


def hearing(*, video: Path, lead: float) -> dict[str, Any]:
    """Whisper's words of the clip as [[word, start, end, probability], …] in seconds from the clip's start."""
    result = transcribe(video=video, lead=lead)
    spoken = [w for segment in result.get('segments') or [] for w in segment.get('words') or []]
    words = [[w['word'].strip(), round(w['start'] - lead, 3), round(w['end'] - lead, 3), round(w['probability'], 3)]
             for w in spoken]
    return {'heard': str(result.get('text') or '').strip(), 'words': words}


def listen(video: Path) -> dict[str, Any]:
    """Two hearings: Whisper hears a clipped edge in one and not the other often enough that both count."""
    return {'duration': duration(video), 'hearings': [hearing(video=video, lead=lead) for lead in LEADS]}


def matched_last(*, said: list[str], words: list[list[Any]]) -> list[Any] | None:
    """Whisper's word for the subtitle's last word, when it heard that word (not a word said after the line)."""
    heard = [words_of(w[0]) for w in words]
    flat = [(i, token) for i, tokens in enumerate(heard) for token in tokens]
    blocks = [b for b in SequenceMatcher(a=said, b=[t for _, t in flat], autojunk=False).get_matching_blocks()
              if b.size]
    if not blocks or blocks[-1].a + blocks[-1].size != len(said):
        return None
    return words[flat[blocks[-1].b + blocks[-1].size - 1][0]]


def verdict(*, text: str, words: list[list[Any]], length: float) -> list[str]:
    if not words:
        return ['Whisper не расслышал реплику']
    said = words_of(text)
    lost_start, lost_end = lost_words(said=said, heard=words_of(' '.join(w[0] for w in words)))
    reasons = []
    if lost_start:
        reasons.append(f'начало обрезано, не слышно «{" ".join(text.split()[:lost_start])}»')
    last = matched_last(said=said, words=words)
    if lost_end:
        reasons.append(f'конец обрезан, не слышно «{" ".join(text.split()[-lost_end:])}»')
    elif last and length - last[2] < NEAR_CUT_SECONDS and last[3] < MIN_PROBABILITY:
        reasons.append(f'последнее слово обрезано, «{last[0]}»')
    return reasons


def check(*, video: Path, text: str) -> Edges:
    """The clip's edges; Whisper's hearing of a file is cached by its content."""
    key = hashlib.sha1(video.read_bytes()).hexdigest()
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    if key not in cache:
        cache[key] = listen(video)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
    heard = cache[key]
    reasons = [r for h in heard['hearings'] for r in verdict(text=text, words=h['words'], length=heard['duration'])]
    return Edges(cut='; '.join(dict.fromkeys(reasons)), heard=heard['hearings'][0]['heard'])
