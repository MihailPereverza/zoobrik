"""zoobrik-listening: make listening cards — cut a clip from a source or voice a dialogue, then time every word."""

import argparse
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import mlx_whisper
import numpy as np
import soundfile
import yaml
from mlx_audio.tts.utils import load_model

from voice_engines import SAMPLE_RATE

WHISPER_MODEL = 'mlx-community/whisper-large-v3-turbo'
LINE_PAUSE_SECONDS = 0.45
KOKORO_MODEL = 'mlx-community/Kokoro-82M-bf16'


@dataclass
class Word:
    """A spoken word with its time in the clip."""

    word: str
    """The word as written in the transcript."""
    start: float
    """Start, seconds from the clip start."""
    end: float
    """End, seconds from the clip start."""


@dataclass
class Segment:
    """One line of the transcript."""

    start: float
    """Start, seconds."""
    end: float
    """End, seconds."""
    text: str
    """What is said."""
    speaker: str = ''
    """Who says it, for dialogues."""
    words: list[Word] = field(default_factory=list)
    """Word timings for highlighting and seeking."""


def seconds(value: float) -> float:
    return round(float(value), 2)


def cut_media(*, source: Path, start: float, end: float, target: Path) -> None:
    video = target.suffix.lower() == '.mp4'
    command = ['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{start:.2f}', '-to', f'{end:.2f}', '-i', str(source)]
    if video:
        command += ['-vf', 'scale=-2:480', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow']
        command += ['-c:a', 'aac', '-b:a', '64k']
        command += ['-ac', '1', '-movflags', '+faststart']
    else:
        command += ['-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k']
    subprocess.run([*command, str(target)], check=True)


def transcribe(*, media: Path, prompt: str) -> list[Segment]:
    options = {'language': 'en', 'word_timestamps': True, 'initial_prompt': prompt or None}
    options['condition_on_previous_text'] = False
    result = mlx_whisper.transcribe(str(media), path_or_hf_repo=WHISPER_MODEL, **options)
    segments = []
    for raw in result['segments']:
        words = [Word(word=w['word'].strip(), start=seconds(w['start']), end=seconds(w['end']))
                 for w in raw.get('words', [])]
        start, end = seconds(raw['start']), seconds(raw['end'])
        segments.append(Segment(start=start, end=end, text=raw['text'].strip(), words=words))
    return segments


def transcript_yaml(segments: list[Segment]) -> str:
    data = {'language': 'en', 'segments': [
        {k: v for k, v in {
            'start': s.start, 'end': s.end, 'speaker': s.speaker or None, 'text': s.text,
            'words': [{'word': w.word, 'start': w.start, 'end': w.end} for w in s.words],
        }.items() if v is not None}
        for s in segments
    ]}
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000, default_flow_style=None)


@dataclass
class DialogueLine:
    """A line of a scripted dialogue."""

    speaker: str
    """Name shown in the transcript."""
    voice: str
    """Kokoro voice, e.g. bf_emma, am_michael."""
    text: str
    """What the speaker says."""


def speak_line(*, model: object, line: DialogueLine) -> np.ndarray:
    results = model.generate(text=line.text, voice=line.voice, lang_code=line.voice[0], speed=0.95)
    return np.concatenate([np.array(r.audio, dtype=np.float32).reshape(-1) for r in results])


def voice_dialogue(*, lines: list[DialogueLine], target: Path) -> list[Segment]:
    # Lines are voiced one by one, so the transcript knows exactly who speaks when; Whisper only times the words.
    model = load_model(KOKORO_MODEL)
    pause = np.zeros(int(SAMPLE_RATE * LINE_PAUSE_SECONDS), dtype=np.float32)
    parts, segments, cursor = [pause], [], LINE_PAUSE_SECONDS
    for line in lines:
        audio = speak_line(model=model, line=line)
        segments.append(line_segment(line=line, audio=audio, offset=cursor))
        parts += [audio, pause]
        cursor += len(audio) / SAMPLE_RATE + LINE_PAUSE_SECONDS
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        soundfile.write(wav.name, np.concatenate(parts), SAMPLE_RATE)
        command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', wav.name, '-ac', '1', '-c:a', 'libmp3lame']
        subprocess.run([*command, '-b:a', '64k', str(target)], check=True)
    return segments


def merge_fragments(words: list[Word]) -> list[Word]:
    # Whisper splits "forty-five", "T-shirt", "o'clock" into pieces that start with - or '; glue them back.
    merged: list[Word] = []
    for word in words:
        if merged and word.word[:1] in "-'’":
            last = merged[-1]
            merged[-1] = Word(word=last.word + word.word, start=last.start, end=word.end)
            continue
        merged.append(word)
    return merged


def line_segment(*, line: DialogueLine, audio: np.ndarray, offset: float) -> Segment:
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        soundfile.write(wav.name, audio, SAMPLE_RATE)
        timed = transcribe(media=Path(wav.name), prompt=line.text)
    words = [Word(word=w.word, start=seconds(w.start + offset), end=seconds(w.end + offset))
             for segment in timed for w in segment.words]
    words = merge_fragments(words)
    written = line.text.split()
    if len(written) == len(words):
        words = [Word(word=text, start=w.start, end=w.end) for text, w in zip(written, words)]
    end = seconds(offset + len(audio) / SAMPLE_RATE)
    return Segment(start=seconds(offset), end=end, text=line.text, speaker=line.speaker, words=words)


def write_card(*, folder: Path, media_name: str, meta: dict) -> None:
    card_file = folder / 'card.yaml'
    if card_file.exists():
        return
    content = {'title': meta['title'], 'media': media_name, 'transcript': 'transcript.yaml'}
    content.update({k: meta[k] for k in ('source', 'license', 'attribution', 'summary') if meta.get(k)})
    card = {'id': folder.name, 'kind': 'listening', 'tags': meta.get('tags', []), 'content': content,
            'exercises': [{'id': 'e1', 'template': 'intro', 'status': 'ready', 'params': {}}]}
    card_file.write_text(yaml.safe_dump(card, allow_unicode=True, sort_keys=False, width=1000), encoding='utf-8')


def clip_command(args: argparse.Namespace) -> None:
    folder = Path(args.card)
    folder.mkdir(parents=True, exist_ok=True)
    media_name = 'clip.mp4' if args.video else 'clip.mp3'
    cut_media(source=Path(args.source), start=args.start, end=args.end, target=folder / media_name)
    prompt = Path(args.prompt_file).read_text(encoding='utf-8') if args.prompt_file else ''
    segments = transcribe(media=folder / media_name, prompt=prompt[-800:])
    (folder / 'transcript.yaml').write_text(transcript_yaml(segments), encoding='utf-8')
    write_card(folder=folder, media_name=media_name, meta=yaml.safe_load(Path(args.meta).read_text(encoding='utf-8')))
    print(f'{folder}: {len(segments)} lines, {sum(len(s.words) for s in segments)} words')


def dialogue_command(args: argparse.Namespace) -> None:
    folder = Path(args.card)
    folder.mkdir(parents=True, exist_ok=True)
    script = yaml.safe_load(Path(args.script).read_text(encoding='utf-8'))
    voices = script['voices']
    lines = [DialogueLine(speaker=item['speaker'], voice=voices[item['speaker']], text=item['text'])
             for item in script['lines']]
    segments = voice_dialogue(lines=lines, target=folder / 'clip.mp3')
    (folder / 'transcript.yaml').write_text(transcript_yaml(segments), encoding='utf-8')
    write_card(folder=folder, media_name='clip.mp3', meta=script['meta'])
    print(f'{folder}: {len(segments)} lines voiced')


def main() -> None:
    parser = argparse.ArgumentParser(description='Make Zoobrik listening cards.')
    sub = parser.add_subparsers(required=True)
    clip = sub.add_parser('clip', help='cut a clip from a source file and time its words')
    clip.add_argument('source')
    clip.add_argument('card', help='card folder, e.g. decks/x/topics/listening-voa/lle-clothes-1')
    clip.add_argument('--start', type=float, required=True)
    clip.add_argument('--end', type=float, required=True)
    clip.add_argument('--video', action='store_true', help='keep the picture (mp4, 480p) instead of audio only')
    clip.add_argument('--meta', required=True, help='YAML with title, source, license, attribution, summary, tags')
    clip.add_argument('--prompt-file', help='official transcript text, helps Whisper spell names and terms')
    clip.set_defaults(run=clip_command)
    dialogue = sub.add_parser('dialogue', help='voice a scripted dialogue with several Kokoro voices')
    dialogue.add_argument('script', help='YAML: meta, voices {speaker: voice}, lines [{speaker, text}]')
    dialogue.add_argument('card')
    dialogue.set_defaults(run=dialogue_command)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()
