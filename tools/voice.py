"""zoobrik-voice: generate missing audio for a deck with Kokoro on Apple Silicon."""

import argparse
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import espeakng_loader
import misaki.espeak  # noqa: F401
import numpy as np
import soundfile
import yaml
from mlx_audio.tts.utils import load_model
from phonemizer.backend.espeak.wrapper import EspeakWrapper

MODEL_ID = 'mlx-community/Kokoro-82M-bf16'
SAMPLE_RATE = 24000
HOMEBREW_ESPEAK_LIBRARY = Path('/opt/homebrew/lib/libespeak-ng.1.dylib')
HOMEBREW_ESPEAK_DATA = Path('/opt/homebrew/opt/espeak-ng/share/espeak-ng-data')
# Kokoro picks the language from the first letter of the voice name, so one default voice per supported language is enough.
DEFAULT_VOICES: dict[str, str] = {
    'en-gb': 'bf_emma', 'en': 'af_heart', 'en-us': 'af_heart', 'es': 'ef_dora', 'fr': 'ff_siwis', 'it': 'if_sara',
    'pt': 'pf_dora', 'hi': 'hf_alpha', 'ja': 'jf_alpha', 'zh': 'zf_xiaobei',
}


@dataclass
class DeckVoice:
    """Which card fields to voice and with which Kokoro voice."""

    field: str
    """Content key of the studied language, e.g. `en` or `es`; `term` is always accepted too."""
    voice: str
    """Kokoro voice name."""


@dataclass
class Clip:
    """One text to voice and where to store it."""

    text: str
    """Text in the studied language."""
    target: Path
    """Destination mp3 file."""


def configure_espeak() -> None:
    # The espeakng-loader wheel has a data path from its CI machine baked in, so point phonemizer to Homebrew's espeak-ng.
    # misaki.espeak overrides the library path when imported, so this must run after the module-level import.
    if HOMEBREW_ESPEAK_LIBRARY.exists():
        EspeakWrapper.set_library(str(HOMEBREW_ESPEAK_LIBRARY))
        EspeakWrapper.set_data_path(str(HOMEBREW_ESPEAK_DATA))
    else:
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())


def speakable(text: str) -> str:
    without_brackets = re.sub(r'\s*\([^)]*\)', '', text)
    return re.sub(r'\s+', ' ', without_brackets.replace('…', '...').replace('—', ', ')).strip()


def deck_voice(*, deck_dir: Path, voice: str | None) -> DeckVoice:
    deck = yaml.safe_load((deck_dir / 'deck.yaml').read_text(encoding='utf-8')) or {}
    target = str((deck.get('lang') or {}).get('target') or 'en-GB').lower()
    code = target.split('-')[0]
    configured = (deck.get('voice') or {}).get(code)
    chosen = voice or configured or DEFAULT_VOICES.get(target) or DEFAULT_VOICES.get(code)
    if not chosen:
        raise SystemExit(f'Kokoro has no voice for {target}; pass --voice or use the browser voice in the app.')
    return DeckVoice(field=code, voice=chosen)


def spoken_text(*, item: dict, field: str) -> str:
    return item.get('term') or item.get(field) or ''


def card_clips(*, card_dir: Path, field: str) -> list[Clip]:
    card = yaml.safe_load((card_dir / 'card.yaml').read_text(encoding='utf-8'))
    content = card.get('content') or {}
    clips = []
    if spoken_text(item=content, field=field) and content.get('audio'):
        clips.append(Clip(text=speakable(spoken_text(item=content, field=field)), target=card_dir / content['audio']))
    for example in content.get('examples') or []:
        if spoken_text(item=example, field=field) and example.get('audio'):
            clips.append(Clip(text=speakable(spoken_text(item=example, field=field)), target=card_dir / example['audio']))
    return clips


def collect_clips(*, deck_dir: Path, field: str, force: bool) -> list[Clip]:
    clips = []
    for card_file in sorted(deck_dir.glob('topics/*/*/card.yaml')):
        clips.extend(card_clips(card_dir=card_file.parent, field=field))
    return [clip for clip in clips if force or not clip.target.exists()]


def encode_mp3(*, audio: np.ndarray, target: Path) -> None:
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        soundfile.write(wav.name, audio, SAMPLE_RATE)
        subprocess.run(
            ['ffmpeg', '-loglevel', 'error', '-y', '-i', wav.name, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', str(target)],
            check=True,
        )


def synthesize(*, model: object, text: str, voice: str, speed: float) -> np.ndarray:
    chunks = [np.array(result.audio) for result in model.generate(text=text, voice=voice, lang_code=voice[0], speed=speed)]
    silence = np.zeros(int(SAMPLE_RATE * 0.15), dtype=np.float32)
    return np.concatenate([silence, *chunks, silence])


def generate(*, clips: list[Clip], voice: str, speed: float) -> None:
    model = load_model(MODEL_ID)
    started = time.time()
    for index, clip in enumerate(clips, start=1):
        encode_mp3(audio=synthesize(model=model, text=clip.text, voice=voice, speed=speed), target=clip.target)
        print(f'[{index}/{len(clips)}] {clip.target.parent.name}/{clip.target.name}: {clip.text}')
    print(f'{len(clips)} clips in {time.time() - started:.0f}s')


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate missing deck audio with Kokoro.')
    parser.add_argument('deck', type=Path, help='deck folder: the one with deck.yaml, e.g. a library root or decks/<id>')
    parser.add_argument('--voice', default=None, help='Kokoro voice; defaults to deck.yaml voice.<lang> or a voice for lang.target')
    parser.add_argument('--speed', type=float, default=0.95)
    parser.add_argument('--force', action='store_true', help='regenerate existing files')
    args = parser.parse_args()
    voice = deck_voice(deck_dir=args.deck, voice=args.voice)
    clips = collect_clips(deck_dir=args.deck, field=voice.field, force=args.force)
    if not clips:
        print('Nothing to voice.')
        return
    configure_espeak()
    generate(clips=clips, voice=voice.voice, speed=args.speed)


if __name__ == '__main__':
    main()
