"""Speech engines for zoobrik-voice: every engine returns mono float32 audio at 24 kHz."""

import gc
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile
import mlx.core as mx
from mlx_audio.tts.utils import load_model

SAMPLE_RATE = 24000
TOOLS_DIR = Path(__file__).resolve().parent
CACHE_DIR = TOOLS_DIR / '.cache'
PIPER_PYTHON = TOOLS_DIR / '.venv-piper' / 'bin' / 'python'
PIPER_VOICE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/{name}'
# Public-domain recording of the Piper "cori" voice; the cloning engines copy its British accent.
REFERENCE_AUDIO = TOOLS_DIR / 'voices' / 'cori-ref.wav'
REFERENCE_TEXT = 'The quick brown fox jumps over the lazy dog. She has long dark hair, and a warm, friendly smile.'


@dataclass(frozen=True)
class EngineSpec:
    """A voice the deck is spoken with."""

    name: str
    """Id used in deck.yaml and in file names, e.g. `turbo` → word.turbo.mp3."""
    accent: str
    """Accent the engine speaks with: `en-gb` or `en-us`; the judge compares against it."""
    title: str
    """Human-readable description for reports."""


ENGINES: dict[str, EngineSpec] = {
    'qwen': EngineSpec(name='qwen', accent='en-gb', title='Qwen3-TTS 1.7B, cloned British voice (Apache-2.0)'),
    'turbo': EngineSpec(name='turbo', accent='en-us', title='Chatterbox Turbo, American voice (MIT)'),
    'melo': EngineSpec(name='melo', accent='en-gb', title='MeloTTS EN-BR (MIT)'),
    'piper': EngineSpec(name='piper', accent='en-gb', title='Piper cori, British voice (public domain)'),
}


def resample(*, audio: np.ndarray, rate: int, target_rate: int = SAMPLE_RATE) -> np.ndarray:
    if rate == target_rate:
        return audio.astype(np.float32)
    with tempfile.NamedTemporaryFile(suffix='.wav') as source, tempfile.NamedTemporaryFile(suffix='.wav') as target:
        soundfile.write(source.name, audio, rate)
        command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', source.name, '-ar', str(target_rate), '-ac', '1']
        command.append(target.name)
        subprocess.run(command, check=True)
        return soundfile.read(target.name, dtype='float32')[0]


def joined(*, results: Any, rate: int) -> np.ndarray:
    parts = [np.array(result.audio, dtype=np.float32).reshape(-1) for result in results]
    return resample(audio=np.concatenate(parts), rate=rate)


class MlxEngine:
    """An engine served by mlx-audio; the model is loaded on first use."""

    def __init__(self, *, repo: str, options: dict[str, Any]) -> None:
        self.repo = repo
        self.options = options
        self.model: Any = None

    def speak(self, text: str) -> np.ndarray:
        if self.model is None:
            self.model = load_model(self.repo)
        results = self.model.generate(text=text, **self.options)
        return joined(results=results, rate=self.model.sample_rate)

    def release(self) -> None:
        self.model = None
        gc.collect()
        mx.clear_cache()


class PiperEngine:
    """Piper runs in its own virtualenv, so it is called as a subprocess."""

    def __init__(self, *, voice: str) -> None:
        self.voice = voice

    def model_path(self) -> Path:
        path = CACHE_DIR / 'piper' / f'{self.voice}.onnx'
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            for name in (f'{self.voice}.onnx', f'{self.voice}.onnx.json'):
                urllib.request.urlretrieve(PIPER_VOICE_URL.format(name=name), path.parent / name)
        return path

    def release(self) -> None:
        return None

    def speak(self, text: str) -> np.ndarray:
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            command = [str(PIPER_PYTHON), '-m', 'piper', '-m', str(self.model_path()), '-f', wav.name]
            command += ['--noise-scale', '0.333']
            subprocess.run(command, input=text.encode(), check=True, capture_output=True)
            audio, rate = soundfile.read(wav.name, dtype='float32')
        return resample(audio=audio, rate=rate)


def build_engine(name: str) -> MlxEngine | PiperEngine:
    if name == 'qwen':
        options = {'ref_audio': str(REFERENCE_AUDIO), 'ref_text': REFERENCE_TEXT}
        return MlxEngine(repo='mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', options=options)
    if name == 'turbo':
        return MlxEngine(repo='mlx-community/chatterbox-turbo-fp16', options={})
    if name == 'melo':
        options = {'lang_code': 'EN-BR', 'voice': 'EN-BR'}
        return MlxEngine(repo='mlx-community/MeloTTS-English-MLX', options=options)
    if name == 'piper':
        return PiperEngine(voice='en_GB-cori-high')
    raise SystemExit(f'Unknown voice engine {name}; known: {", ".join(ENGINES)}')
