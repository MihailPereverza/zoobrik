"""zoobrik-voice: voice every word and example of a deck with several voices that pass a listening check."""

import argparse
import json
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile
import yaml

from voice_engines import CACHE_DIR, ENGINES, SAMPLE_RATE, MlxEngine, PiperEngine, build_engine
from voice_judge import Judge, Verdict

DEFAULT_ENGINES = ['qwen', 'turbo', 'melo', 'piper']
ATTEMPTS = 3
TARGET_LUFS = -16
TRUE_PEAK_DB = -1.5
PAD_SECONDS = 0.15


@dataclass
class Clip:
    """One text to voice and the file it belongs to."""

    text: str
    """Text in the studied language."""
    target: Path
    """Primary mp3 file, e.g. word.mp3; other voices go next to it as word.<voice>.mp3."""


@dataclass
class Take:
    """The best attempt of one engine for one clip."""

    engine: str
    """Engine name."""
    audio: np.ndarray
    """Audio at 24 kHz."""
    verdict: Verdict
    """What the judge heard."""


@dataclass
class ClipResult:
    """What was written for a clip."""

    clip: Clip
    """The clip."""
    written: list[str] = field(default_factory=list)
    """Engines whose take was saved; the first one is in the primary file."""
    review: list[str] = field(default_factory=list)
    """Engines saved although the phoneme check was unsure: Whisper heard the words, the sounds differ."""
    failed: list[str] = field(default_factory=list)
    """Engines with no usable take: Whisper never heard the right words."""


def speakable(text: str) -> str:
    without_brackets = re.sub(r'\s*\([^)]*\)', '', text)
    spoken = re.sub(r'\s+', ' ', without_brackets.replace('…', '...').replace('—', ', ')).strip()
    # A bare word with no final punctuation makes every engine trail off or mumble; a full stop gives it a clean ending.
    spoken = spoken if re.search(r'[.!?]$', spoken) else f'{spoken}.'
    return spoken[:1].upper() + spoken[1:]


def spoken_text(*, item: dict, field_name: str) -> str:
    return item.get('term') or item.get(field_name) or ''


def card_clips(*, card_dir: Path, field_name: str) -> list[Clip]:
    card = yaml.safe_load((card_dir / 'card.yaml').read_text(encoding='utf-8'))
    content = card.get('content') or {}
    items = [content, *(content.get('examples') or [])]
    return [
        Clip(text=spoken_text(item=item, field_name=field_name), target=card_dir / item['audio'])
        for item in items
        if spoken_text(item=item, field_name=field_name) and item.get('audio')
    ]


def collect_clips(*, deck_dir: Path, field_name: str) -> list[Clip]:
    clips = []
    for card_file in sorted(deck_dir.glob('topics/*/*/card.yaml')):
        clips.extend(card_clips(card_dir=card_file.parent, field_name=field_name))
    return clips


def deck_language(deck_dir: Path) -> str:
    deck = yaml.safe_load((deck_dir / 'deck.yaml').read_text(encoding='utf-8')) or {}
    target = str((deck.get('lang') or {}).get('target') or 'en-GB').lower()
    if not target.startswith('en'):
        raise SystemExit(f'The voices here speak English only; deck language is {target}.')
    return target.split('-')[0]


def variant_path(*, clip: Clip, engine: str) -> Path:
    return clip.target.with_name(f'{clip.target.stem}.{engine}{clip.target.suffix}')


def encode_mp3(*, audio: np.ndarray, target: Path) -> None:
    silence = np.zeros(int(SAMPLE_RATE * PAD_SECONDS), dtype=np.float32)
    padded = np.concatenate([silence, audio, silence])
    # Phones play speech around -16 LUFS; the limiter only catches the rare peaks the gain would push past full scale.
    level = f'loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DB}:LRA=11,alimiter=limit={10 ** (TRUE_PEAK_DB / 20):.3f}'
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        soundfile.write(wav.name, padded, SAMPLE_RATE)
        command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', wav.name, '-af', level]
        command += ['-ar', str(SAMPLE_RATE), '-ac', '1']
        command += ['-c:a', 'libmp3lame', '-b:a', '64k', str(target)]
        subprocess.run(command, check=True)


def best_take(*, engine: str, speaker: MlxEngine | PiperEngine, judge: Judge, text: str) -> Take | None:
    best: Take | None = None
    for _ in range(ATTEMPTS):
        audio = speaker.speak(text)
        verdict = judge.verdict(audio=audio, text=text, accent=ENGINES[engine].accent)
        if best is None or verdict.score < best.verdict.score:
            best = Take(engine=engine, audio=audio, verdict=verdict)
        if verdict.passed:
            break
    return best if best and best.verdict.words_match else None


def voice_clip(*, clip: Clip, speakers: dict[str, MlxEngine | PiperEngine], judge: Judge) -> ClipResult:
    result = ClipResult(clip=clip)
    text = speakable(clip.text)
    # Files of a voice that fails this time must not linger from an earlier run.
    for engine in ENGINES:
        variant_path(clip=clip, engine=engine).unlink(missing_ok=True)
    for engine, speaker in speakers.items():
        take = best_take(engine=engine, speaker=speaker, judge=judge, text=text)
        if take is None:
            result.failed.append(engine)
            continue
        target = clip.target if not result.written else variant_path(clip=clip, engine=engine)
        encode_mp3(audio=take.audio, target=target)
        result.written.append(engine)
        if not take.verdict.passed:
            result.review.append(f'{engine}: {take.verdict.heard!r} ({take.verdict.distance:.2f})')
    return result


def progress_file(deck_dir: Path) -> Path:
    return CACHE_DIR / f'voice-progress-{deck_dir.resolve().name}.json'


def load_done(*, deck_dir: Path, force: bool) -> set[str]:
    path = progress_file(deck_dir)
    if force or not path.exists():
        return set()
    return set(json.loads(path.read_text(encoding='utf-8')))


def save_done(*, deck_dir: Path, done: set[str]) -> None:
    path = progress_file(deck_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted(done)), encoding='utf-8')


def report_line(result: ClipResult) -> str:
    where = f'{result.clip.target.parent.name}/{result.clip.target.name}'
    notes = '; '.join([*(f'review {r}' for r in result.review), *(f'failed {f}' for f in result.failed)])
    return f'{where}\t{",".join(result.written)}\t{result.clip.text}\t{notes}'


def clips_with_failures(deck_dir: Path) -> set[str]:
    report = CACHE_DIR / f'voice-report-{deck_dir.resolve().name}.tsv'
    lines = report.read_text(encoding='utf-8').splitlines() if report.exists() else []
    return {line.split('\t')[0] for line in lines if 'failed ' in line}


def run(*, deck_dir: Path, engines: list[str], force: bool, only: str, redo_failed: bool) -> None:
    every_clip = collect_clips(deck_dir=deck_dir, field_name=deck_language(deck_dir))
    clips = [clip for clip in every_clip if only in str(clip.target)]
    done = load_done(deck_dir=deck_dir, force=force)
    if redo_failed:
        failed = clips_with_failures(deck_dir)
        done -= {str(clip.target) for clip in clips if f'{clip.target.parent.name}/{clip.target.name}' in failed}
    todo = [clip for clip in clips if str(clip.target) not in done]
    print(f'{len(todo)} of {len(clips)} clips to voice with {", ".join(engines)}', flush=True)
    speakers, judge, started = {name: build_engine(name) for name in engines}, Judge(), time.time()
    report = CACHE_DIR / f'voice-report-{deck_dir.resolve().name}.tsv'
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open('a', encoding='utf-8') as out:
        for index, clip in enumerate(todo, start=1):
            result = voice_clip(clip=clip, speakers=speakers, judge=judge)
            out.write(report_line(result) + '\n')
            out.flush()
            done.add(str(clip.target))
            save_done(deck_dir=deck_dir, done=done)
            print(f'[{index}/{len(todo)}] {time.time() - started:.0f}s {report_line(result)}', flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description='Voice deck audio with several engines and a listening check.')
    parser.add_argument('deck', type=Path, help='deck folder with deck.yaml: a library root or decks/<id>')
    parser.add_argument('--engines', default=','.join(DEFAULT_ENGINES), help='comma-separated voices, first is primary')
    parser.add_argument('--force', action='store_true', help='start over instead of continuing the previous run')
    parser.add_argument('--only', default='', help='voice only clips whose path contains this, e.g. hair/word')
    parser.add_argument('--redo-failed', action='store_true', help='voice again the clips where some voice failed')
    args = parser.parse_args()
    engines = args.engines.split(',')
    run(deck_dir=args.deck, engines=engines, force=args.force, only=args.only, redo_failed=args.redo_failed)


if __name__ == '__main__':
    main()
