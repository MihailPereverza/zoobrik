"""zoobrik-human-audio: put human recordings next to the synthetic ones and credit their authors in credits.yaml.

Usage: human_audio.py <deck> <mapping.yaml> [--dry-run]

The mapping is a YAML list of recordings:

    - file: topics/basics/common/ex1.human.mp3      # deck-relative: <name>.human.mp3 or <name>.human-2.mp3
      url: https://tatoeba.org/audio/download/21102  # what to download
      author: Charles Kelly (CK)
      license: CC BY-NC-ND 3.0
      source: https://tatoeba.org/audio/download/21102   # shown in the app as the link to the recording
      text: 'Tatoeba #294881 · CC BY 2.0 FR'         # optional: credit for the sentence itself
      notice: The 48kbps MP3 Files of ... are licensed under ...   # optional: text the licence requires to show

A recording under a NoDerivatives licence is stored byte for byte (it must already be an MP3); any other one is
trimmed, levelled to the loudness tools/voice.py uses and encoded as mono MP3.
"""

import argparse
import hashlib
import json
import math
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import yaml

CACHE_DIR = Path(__file__).resolve().parent / '.cache' / 'human-audio'
USER_AGENT = 'zoobrik-human-audio/1.0 (personal language-learning app)'
TARGET_LUFS = -16
TRUE_PEAK_DB = -1.5
# The limiter sees samples, not true peaks; MP3 encoding adds a little more on top.
LIMIT_MARGIN_DB = 0.2
SAMPLE_RATE = 44100
PAD_SECONDS = 0.15
SILENCE_DB = -45
KNOWN_LICENSES = ('CC0', 'CC BY', 'PUBLIC DOMAIN', 'PD', 'FAL')
MP3_MAGIC = (b'ID3', b'\xff\xfb', b'\xff\xf3', b'\xff\xf2')
HUMAN_NAME = re.compile(r'\.human(?:-\d+)?\.mp3$')
DOWNLOAD_ATTEMPTS = 4


@dataclass
class Recording:
    """One human recording to place in the deck."""

    file: str
    """Deck-relative target, e.g. topics/basics/common/ex1.human.mp3."""
    url: str
    """Where the original recording is downloaded from."""
    author: str
    """Speaker or uploader, as the licence asks to attribute."""
    license: str
    """Licence name, e.g. CC BY-SA 4.0 or CC BY-NC-ND 3.0."""
    source: str
    """Page or file the credit links to."""
    text: str = ''
    """Credit for the spoken text when it comes from elsewhere (a Tatoeba sentence)."""
    notice: str = ''
    """Verbatim notice the licence requires to be shown with the recording."""

    def credit(self) -> dict[str, str]:
        entry = {'author': self.author, 'license': self.license, 'source': self.source}
        return {**entry, 'text': self.text} if self.text else entry


def no_derivatives(license_name: str) -> bool:
    return '-ND' in license_name.upper().replace(' ', '-')


def known_license(license_name: str) -> bool:
    return license_name.upper().replace('-', ' ', 1).startswith(KNOWN_LICENSES)


def load_mapping(path: Path) -> list[Recording]:
    rows = yaml.safe_load(path.read_text(encoding='utf-8')) or []
    recordings = [Recording(**{key: str(value) for key, value in row.items()}) for row in rows]
    for recording in recordings:
        if not HUMAN_NAME.search(recording.file):
            raise SystemExit(f'{recording.file}: a human recording is named <name>.human.mp3 or <name>.human-N.mp3')
        if not recording.author or not known_license(recording.license):
            raise SystemExit(f'{recording.file}: no author or no reusable licence ({recording.license!r})')
    return recordings


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    for attempt in range(DOWNLOAD_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == DOWNLOAD_ATTEMPTS - 1:
                raise
        except urllib.error.URLError:
            if attempt == DOWNLOAD_ATTEMPTS - 1:
                raise
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'{url}: no response')


def cached_download(url: str) -> Path:
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower() or '.bin'
    path = CACHE_DIR / f'{hashlib.sha1(url.encode()).hexdigest()}{suffix}'
    if not path.exists():
        body = fetch(url)
        if not body:
            raise RuntimeError(f'{url}: empty download')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        time.sleep(1)
    return path


def trim_filter() -> str:
    trim = f'silenceremove=start_periods=1:start_threshold={SILENCE_DB}dB:start_silence=0.05'
    return ','.join([trim, 'areverse', trim, 'areverse', f'adelay={int(PAD_SECONDS * 1000)}:all=1',
                     f'apad=pad_dur={PAD_SECONDS}'])


def gain_to_target(source: Path) -> float:
    command = ['ffmpeg', '-hide_banner', '-nostats', '-i', str(source)]
    command += ['-af', f'{trim_filter()},loudnorm=print_format=json', '-f', 'null', '-']
    log = subprocess.run(command, capture_output=True, text=True, check=True).stderr
    measured = float(json.loads(log[log.rindex('{'):log.rindex('}') + 1])['input_i'])
    return TARGET_LUFS - measured if math.isfinite(measured) else 0.0


def encode_levelled(*, source: Path, target: Path) -> None:
    # One-pass loudnorm misses the target on clips this short, so the gain is measured first and applied linearly.
    limit = 10 ** ((TRUE_PEAK_DB - LIMIT_MARGIN_DB) / 20)
    gain = f'volume={gain_to_target(source):.2f}dB'
    chain = f'{trim_filter()},{gain},aresample={SAMPLE_RATE * 4},alimiter=limit={limit:.3f}:level=disabled'
    with tempfile.TemporaryDirectory() as scratch:
        draft = Path(scratch) / 'levelled.mp3'
        command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(source), '-af', chain]
        command += ['-ar', str(SAMPLE_RATE), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1']
        subprocess.run([*command, str(draft)], check=True)
        target.write_bytes(draft.read_bytes())


def store_original(*, source: Path, target: Path) -> None:
    body = source.read_bytes()
    if not body.startswith(MP3_MAGIC):
        raise RuntimeError(f'{target}: a NoDerivatives recording must already be an MP3; it cannot be converted')
    target.write_bytes(body)


def place(*, deck_dir: Path, recording: Recording) -> None:
    target = deck_dir / recording.file
    if not target.parent.is_dir():
        raise RuntimeError(f'{recording.file}: no card folder {target.parent}')
    source = cached_download(recording.url)
    if no_derivatives(recording.license):
        store_original(source=source, target=target)
    else:
        encode_levelled(source=source, target=target)


def load_credits(deck_dir: Path) -> dict:
    path = deck_dir / 'credits.yaml'
    credits = yaml.safe_load(path.read_text(encoding='utf-8')) if path.exists() else None
    credits = credits or {}
    return {'notices': list(credits.get('notices') or []), 'files': dict(credits.get('files') or {})}


def save_credits(*, deck_dir: Path, credits: dict) -> None:
    options = {'allow_unicode': True, 'sort_keys': False, 'width': 1000}
    notices = yaml.safe_dump({'notices': credits['notices']}, default_flow_style=False, **options)
    files = yaml.safe_dump({'files': dict(sorted(credits['files'].items()))}, default_flow_style=None, **options)
    (deck_dir / 'credits.yaml').write_text(notices + files, encoding='utf-8')


def up_to_date(*, deck_dir: Path, recording: Recording, credits: dict) -> bool:
    return (deck_dir / recording.file).exists() and credits['files'].get(recording.file) == recording.credit()


def place_all(*, deck_dir: Path, todo: list[Recording], credits: dict) -> list[str]:
    failed, unreachable = [], set()
    for index, recording in enumerate(todo, start=1):
        host = urllib.parse.urlparse(recording.url).netloc
        print(f'[{index}/{len(todo)}] {recording.file} ← {recording.url} ({recording.license})', flush=True)
        if host in unreachable:
            failed.append(f'{recording.file}: {host} is unreachable')
            continue
        try:
            place(deck_dir=deck_dir, recording=recording)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            if isinstance(error, urllib.error.URLError) and not isinstance(error, urllib.error.HTTPError):
                unreachable.add(host)
            failed.append(f'{recording.file}: {error}')
            continue
        credits['files'][recording.file] = recording.credit()
        save_credits(deck_dir=deck_dir, credits=credits)
    return failed


def run(*, deck_dir: Path, mapping: Path, dry_run: bool) -> None:
    recordings = load_mapping(mapping)
    credits = load_credits(deck_dir)
    todo = [r for r in recordings if not up_to_date(deck_dir=deck_dir, recording=r, credits=credits)]
    print(f'{len(todo)} of {len(recordings)} recordings to place', flush=True)
    if dry_run:
        for recording in todo:
            how = 'as is' if no_derivatives(recording.license) else 'levelled'
            print(f'{recording.file} ← {recording.url} ({recording.license}, {how})')
        return
    failed = place_all(deck_dir=deck_dir, todo=todo, credits=credits)
    notices = [r.notice for r in recordings if r.notice and r.notice not in credits['notices']]
    credits['notices'].extend(dict.fromkeys(notices))
    if todo or notices:
        save_credits(deck_dir=deck_dir, credits=credits)
    if failed:
        raise SystemExit(f'{len(failed)} not placed, run again to retry:\n' + '\n'.join(failed))


def main() -> None:
    parser = argparse.ArgumentParser(description='Add human recordings to a deck and credit them in credits.yaml.')
    parser.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    parser.add_argument('mapping', type=Path, help='YAML list of {file, url, author, license, source, text?, notice?}')
    parser.add_argument('--dry-run', action='store_true', help='only list what would be downloaded and written')
    args = parser.parse_args()
    if not (args.deck / 'deck.yaml').exists():
        raise SystemExit(f'{args.deck}: no deck.yaml')
    run(deck_dir=args.deck, mapping=args.mapping, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
