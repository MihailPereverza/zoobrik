"""Automatic listening check: Whisper for the words, a phoneme recogniser for the sounds."""

import re
import tempfile
from dataclasses import dataclass

import mlx_whisper
import numpy as np
import soundfile
import torch
from phonemizer import phonemize
from phonemizer.backend.espeak.wrapper import EspeakWrapper
from transformers import AutoModelForCTC, AutoProcessor

from voice_engines import SAMPLE_RATE, resample

WHISPER_MODEL = 'mlx-community/whisper-large-v3-turbo'
PHONEME_MODEL = 'facebook/wav2vec2-lv-60-espeak-cv-ft'
HOMEBREW_ESPEAK_LIBRARY = '/opt/homebrew/lib/libespeak-ng.1.dylib'
HOMEBREW_ESPEAK_DATA = '/opt/homebrew/opt/espeak-ng/share/espeak-ng-data'
# The recogniser and espeak spell some sounds differently; accents differ in ways a take should not fail for.
PHONEME_FOLDS = [
    ('ɹ', 'r'), ('ɚ', 'ər'), ('ɝ', 'ɜr'), ('ɐ', 'ə'), ('ᵻ', 'ɪ'), ('ɾ', 't'), ('ʔ', 't'), ('ɫ', 'l'),
    ('oʊ', 'əʊ'), ('ɑː', 'ɑ'), ('ɒ', 'ɑ'), ('ɔ', 'ɑ'), ('ts', 't s'), ('tʃ', 't ʃ'), ('dʒ', 'd ʒ'),
    ('ph', 'p'), ('th', 't'), ('kh', 'k'),
]
MAX_PHONEME_DISTANCE = 0.34
RECOGNISER_RATE = 16000
WHISPER_MISS_PENALTY = 0.6


@dataclass
class Verdict:
    """How one take sounds to the judge."""

    passed: bool
    """Whisper heard the right words and the sounds are close to the dictionary."""
    words_match: bool
    """Whisper heard exactly the expected words."""
    distance: float
    """Phoneme edit distance divided by the expected length: 0 is perfect."""
    heard: str
    """What Whisper heard."""

    @property
    def score(self) -> float:
        return self.distance + (0 if self.words_match else WHISPER_MISS_PENALTY)


def words(text: str) -> list[str]:
    british = text.lower().replace('mustache', 'moustache').replace('-', ' ')
    return re.sub(r"[^a-z' ]", '', british).split()


def phoneme_tokens(text: str) -> list[str]:
    folded = re.sub(r'[ˈˌːˑ.,!?\d]', '', text)
    for source, target in PHONEME_FOLDS:
        folded = folded.replace(source, target)
    return [token for token in re.split(r'\s+|(?<=.)(?=.)', folded) if token]


def edit_distance(*, heard: list[str], expected: list[str]) -> int:
    row = list(range(len(expected) + 1))
    for i, sound in enumerate(heard, 1):
        diagonal, row[0] = row[0], i
        for j, wanted in enumerate(expected, 1):
            diagonal, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, diagonal + (sound != wanted))
    return row[-1]


class Judge:
    """Loads both recognisers once and scores takes."""

    def __init__(self) -> None:
        EspeakWrapper.set_library(HOMEBREW_ESPEAK_LIBRARY)
        EspeakWrapper.set_data_path(HOMEBREW_ESPEAK_DATA)
        self.processor = AutoProcessor.from_pretrained(PHONEME_MODEL)
        self.recogniser = AutoModelForCTC.from_pretrained(PHONEME_MODEL).eval()

    def sounds(self, audio: np.ndarray) -> str:
        audio_16k = resample(audio=audio, rate=SAMPLE_RATE, target_rate=RECOGNISER_RATE)
        inputs = self.processor(audio_16k, sampling_rate=RECOGNISER_RATE, return_tensors='pt').input_values
        with torch.no_grad():
            ids = self.recogniser(inputs).logits.argmax(-1)
        return self.processor.batch_decode(ids)[0]

    def verdict(self, *, audio: np.ndarray, text: str, accent: str) -> Verdict:
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            soundfile.write(wav.name, audio, SAMPLE_RATE)
            heard = mlx_whisper.transcribe(wav.name, path_or_hf_repo=WHISPER_MODEL, language='en')['text'].strip()
        expected = phoneme_tokens(phonemize(text, language=accent, backend='espeak', strip=True))
        distance = edit_distance(heard=phoneme_tokens(self.sounds(audio)), expected=expected) / max(len(expected), 1)
        words_match = words(heard) == words(text)
        passed = words_match and distance <= MAX_PHONEME_DISTANCE
        return Verdict(passed=passed, words_match=words_match, distance=distance, heard=heard)

