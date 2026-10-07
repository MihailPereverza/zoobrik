"""zoobrik-listening: cut listening clips from licensed sources, time every word and write listening cards."""

import argparse
import difflib
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import mlx_whisper
import yaml

WHISPER_MODEL = 'mlx-community/whisper-large-v3-turbo'
VIDEO_HEIGHT = 360
SEGMENT_PAD = 0.15
MIN_SEGMENT = 1.2
MAX_SEGMENT = 12.0
MAX_PAUSE = 6.0
SCRIPT_LINE = re.compile(r'^\s*([A-Z][\w .\'-]{0,30}?):\s+(.+)$')


@dataclass
class Word:
    """A spoken word with its timing inside the clip."""

    text: str
    """The word as written in the transcript."""
    start: float
    """Start, seconds from the clip start."""
    end: float
    """End, seconds from the clip start."""


@dataclass
class Line:
    """One line of the transcript: a sentence or a speaker's turn."""

    text: str
    """Line text."""
    speaker: str = ''
    """Speaker name for dialogues."""
    words: list[Word] = field(default_factory=list)
    """Timed words."""


@dataclass
class Clip:
    """A clip to cut, as described in the clips file."""

    id: str
    """Card id and folder name."""
    spec: dict[str, Any]
    """Everything else from the clips file."""


def norm(token: str) -> str:
    return re.sub(r"[^a-z0-9']", '', token.lower().replace('’', "'"))


def run_ffmpeg(*, args: list[str]) -> None:
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def cut_media(*, source: Path, clip: Clip, folder: Path) -> str:
    start, end = str(clip.spec['start']), str(clip.spec['end'])
    if clip.spec.get('video', source.suffix.lower() in ('.mp4', '.mov', '.webm', '.mkv')):
        # Some sources burn subtitles into the picture; cropping them off keeps the clip a listening task.
        crop = float(clip.spec.get('crop_bottom', 0))
        scale = (f'crop=iw:trunc(ih*{1 - crop:.3f}/2)*2:0:0,' if crop else '') + f'scale=-2:{VIDEO_HEIGHT}'
        run_ffmpeg(
            args=[
                '-ss',
                start,
                '-to',
                end,
                '-i',
                str(source),
                '-vf',
                scale,
                '-c:v',
                'libx264',
                '-crf',
                '30',
                '-preset',
                'veryfast',
                '-c:a',
                'aac',
                '-b:a',
                '64k',
                '-ac',
                '1',
                '-movflags',
                '+faststart',
                str(folder / 'clip.mp4'),
            ]
        )
        mid = (float(clip.spec['end']) - float(clip.spec['start'])) / 3
        run_ffmpeg(
            args=[
                '-ss',
                str(mid),
                '-i',
                str(folder / 'clip.mp4'),
                '-frames:v',
                '1',
                '-q:v',
                '5',
                str(folder / 'poster.jpg'),
            ]
        )
        return 'clip.mp4'
    run_ffmpeg(
        args=[
            '-ss',
            start,
            '-to',
            end,
            '-i',
            str(source),
            '-ac',
            '1',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '64k',
            str(folder / 'clip.mp3'),
        ]
    )
    return 'clip.mp3'


def whisper_words(media: Path) -> list[Word]:
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        run_ffmpeg(args=['-i', str(media), '-ar', '16000', '-ac', '1', wav.name])
        # The script is matched afterwards: as an initial prompt it makes Whisper skip or invent words.
        result = mlx_whisper.transcribe(
            wav.name,
            path_or_hf_repo=WHISPER_MODEL,
            language='en',
            word_timestamps=True,
            condition_on_previous_text=False,
        )
    return [
        Word(text=w['word'].strip(), start=float(w['start']), end=float(w['end']))
        for segment in result['segments']
        for w in segment.get('words', [])
        if w['word'].strip()
    ]


def sentences(prose: str) -> list[Line]:
    parts = re.split(r'(?:(?<=[.!?])|(?<=[.!?]["”’]))\s+(?=["“‘]?[A-Z])', re.sub(r'\s+', ' ', prose).strip())
    return [Line(text=part) for part in parts if part]


def script_lines(text: str) -> list[Line]:
    """Speaker turns stay whole; prose without speakers (books, lectures) is re-split into sentences across line breaks."""
    lines: list[Line] = []
    prose: list[str] = []
    for raw in text.splitlines():
        raw = raw.strip()
        if raw.startswith('#'):
            continue
        match = SCRIPT_LINE.match(raw)
        if match or not raw:
            lines.extend(sentences(' '.join(prose)))
            prose = []
        if match:
            lines.append(Line(text=match.group(2), speaker=match.group(1)))
        elif raw:
            prose.append(raw)
    lines.extend(sentences(' '.join(prose)))
    return lines


def align(*, lines: list[Line], heard: list[Word]) -> list[Line]:
    """Gives every script word the timing of the matching recognised word; unmatched words share their neighbours' time."""
    script = [(i, token) for i, line in enumerate(lines) for token in line.text.split()]
    matcher = difflib.SequenceMatcher(a=[norm(t) for _, t in script], b=[norm(w.text) for w in heard], autojunk=False)
    timing: dict[int, Word] = {}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            timing[block.a + k] = heard[block.b + k]
    for line in lines:
        line.words = []
    for pos, (line_index, token) in enumerate(script):
        known = timing.get(pos)
        lines[line_index].words.append(
            Word(text=token, start=known.start if known else -1, end=known.end if known else -1)
        )
    # Script lines outside the cut fragment get no timing at all and are dropped.
    return [fill_gaps(line) for line in lines if any(w.start >= 0 for w in line.words)]


def split_on_pauses(lines: list[Line]) -> list[Line]:
    """A script line that spans a long pause (a scene cut, a teaching break) becomes two lines."""
    out: list[Line] = []
    for line in lines:
        current = Line(text='', speaker=line.speaker)
        for word in line.words:
            if current.words and word.start - current.words[-1].end > MAX_PAUSE:
                out.append(current)
                current = Line(text='', speaker=line.speaker)
            current.words.append(word)
        out.append(current)
    for line in out:
        line.text = ' '.join(w.text for w in line.words)
    return out


def fill_gaps(line: Line) -> Line:
    timed = [w for w in line.words if w.start >= 0]
    if not timed:
        return line
    last_end = timed[0].start
    for w in line.words:
        if w.start < 0:
            w.start, w.end = last_end, last_end
        last_end = w.end
    return line


def lines_from_whisper(heard: list[Word]) -> list[Line]:
    lines, current = [], Line(text='')
    for w in heard:
        current.words.append(w)
        if re.search(r'[.!?]["”]?$', w.text):
            current.text = ' '.join(x.text for x in current.words)
            lines.append(current)
            current = Line(text='')
    if current.words:
        current.text = ' '.join(x.text for x in current.words)
        lines.append(current)
    return lines


def cut_segments(*, media: Path, lines: list[Line], folder: Path) -> None:
    for old in folder.glob('seg*.mp3'):
        old.unlink()
    for n, line in enumerate(lines, start=1):
        start, end = line.words[0].start, line.words[-1].end
        if not MIN_SEGMENT <= end - start <= MAX_SEGMENT:
            continue
        # Resampling avoids ffmpeg's frame-padding error when re-encoding mp3 to mp3.
        args = [
            '-ss',
            str(max(0.0, start - SEGMENT_PAD)),
            '-to',
            str(end + SEGMENT_PAD),
            '-i',
            str(media),
            '-vn',
            '-ac',
            '1',
        ]
        args += ['-af', 'aresample=44100', '-c:a', 'libmp3lame', '-b:a', '64k', str(folder / f'seg{n}.mp3')]
        try:
            run_ffmpeg(args=args)
        except subprocess.CalledProcessError:
            print(f'  seg{n}: ffmpeg failed, skipped', flush=True)


def transcript_yaml(*, lines: list[Line], duration: float) -> dict[str, Any]:
    segments = []
    for n, line in enumerate(lines, start=1):
        item: dict[str, Any] = {'n': n, 'start': round(line.words[0].start, 2), 'end': round(line.words[-1].end, 2)}
        if line.speaker:
            item['speaker'] = line.speaker
        item['text'] = ' '.join(w.text for w in line.words)
        item['words'] = [[w.text, round(w.start, 2), round(w.end, 2)] for w in line.words]
        segments.append(item)
    return {'duration': round(duration, 2), 'segments': segments}


def media_duration(path: Path) -> float:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())


def write_card(*, folder: Path, clip: Clip, media: str) -> None:
    """Card content comes from the clips file; exercises and progress already in card.yaml are kept."""
    card_file = folder / 'card.yaml'
    card = yaml.safe_load(card_file.read_text(encoding='utf-8')) if card_file.exists() else {}
    content = {
        'title': clip.spec['title'],
        'level': clip.spec.get('level', 'A2'),
        'media': media,
        'transcript': 'transcript.yaml',
        'source': clip.spec['source'],
    }
    if media.endswith('.mp4'):
        content['poster'] = 'poster.jpg'
    if clip.spec.get('summary'):
        content['note'] = clip.spec['summary']
    card = {
        'id': clip.id,
        'kind': 'listening',
        'tags': clip.spec.get('tags', []),
        'content': content,
        'exercises': card.get('exercises', []),
        **({'progress': card['progress']} if card.get('progress') else {}),
    }
    card_file.write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False, width=1000), encoding='utf-8')


def script_text(*, clip: Clip, sources: Path) -> str:
    if clip.spec.get('script'):
        return str(clip.spec['script'])
    if clip.spec.get('script_file'):
        return (sources / clip.spec['script_file']).read_text(encoding='utf-8')
    return ''


@dataclass
class Span:
    """Where the scripted dialogue sits in the source file."""

    start: float
    """Seconds from the source start."""
    end: float
    """Seconds from the source start."""


def dialogue_span(*, source: Path, script: str) -> Span:
    heard = whisper_words(source)
    lines = align(lines=script_lines(script), heard=heard)
    return Span(start=max(0.0, lines[0].words[0].start - 1.0), end=lines[-1].words[-1].end + 1.2)


def build_clip(*, clip: Clip, sources: Path, deck: Path) -> int:
    folder = deck / 'topics' / clip.spec.get('topic', 'listening') / clip.id
    folder.mkdir(parents=True, exist_ok=True)
    script = script_text(clip=clip, sources=sources)
    if 'start' not in clip.spec:
        span = dialogue_span(source=sources / clip.spec['file'], script=script)
        clip.spec['start'], clip.spec['end'] = span.start, span.end
        print(f'{clip.id}: dialogue at {clip.spec["start"]:.1f}–{clip.spec["end"]:.1f}s', flush=True)
    media = cut_media(source=sources / clip.spec['file'], clip=clip, folder=folder)
    heard = whisper_words(folder / media)
    lines = split_on_pauses(align(lines=script_lines(script), heard=heard)) if script else lines_from_whisper(heard)
    duration = media_duration(folder / media)
    (folder / 'transcript.yaml').write_text(
        yaml.safe_dump(
            transcript_yaml(lines=lines, duration=duration),
            allow_unicode=True,
            sort_keys=False,
            width=1000,
            default_flow_style=None,
        ),
        encoding='utf-8',
    )
    cut_segments(media=folder / media, lines=lines, folder=folder)
    write_card(folder=folder, clip=clip, media=media)
    return len(lines)


def load_clips(path: Path) -> list[Clip]:
    data = yaml.safe_load(path.read_text(encoding='utf-8'))
    return [Clip(id=item.pop('id'), spec=item) for item in data['clips']]


def main() -> None:
    parser = argparse.ArgumentParser(description='Cut listening clips, time their words and write listening cards.')
    parser.add_argument('clips', type=Path, help='clips file (YAML) describing what to cut')
    parser.add_argument('--sources', type=Path, required=True, help='folder with the downloaded source files')
    parser.add_argument('--deck', type=Path, required=True, help='deck folder with deck.yaml')
    parser.add_argument('--only', default='', help='cut only clips whose id contains this')
    parser.add_argument('--missing', action='store_true', help='cut only clips that have no transcript yet')
    args = parser.parse_args()
    for clip in load_clips(args.clips):
        done = (args.deck / 'topics' / clip.spec.get('topic', 'listening') / clip.id / 'transcript.yaml').exists()
        if args.only in clip.id and not (args.missing and done):
            count = build_clip(clip=clip, sources=args.sources, deck=args.deck)
            print(f'{clip.id}: {count} lines', flush=True)


if __name__ == '__main__':
    main()
