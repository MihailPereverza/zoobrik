"""zoobrik-clips: short movie fragments from playphrase.me as small local video files of a card.

Usage:
  clips.py search <deck> --card <topic/card> --phrase "in the morning" [--max 6] [--out candidates.yaml]
  clips.py fetch <deck> <candidates.yaml> [--ids <id> …] [--audio-phrase]
  clips.py localize <deck> [--cards <id> …]
  clips.py check <deck> [--cards <id> …] [--reject]

`search` asks playphrase.me (one request per 1.5 s, at most three pages per phrase, every answer cached under
tools/.cache/playphrase/) and writes the clean, clearly spoken lines from different films to a candidates file.
`fetch` downloads the chosen clips (raw files cached in tools/.cache/playphrase/raw/), trims each to its line, encodes
it small (640×360, H.264, mono AAC levelled to −16 LUFS) into <card>/clips/pp-<id>.mp4 and prints the `clip:` parameter
to paste into an exercise. With --audio-phrase it also cuts the searched words into pp-<id>.phrase.mp3 and keeps that
file only when Whisper hears the phrase in it.
`localize` turns the clip-type / clip-choice exercises that link a playphrase.me video into local ones: the whole clip
(not trimmed, so the `words` timings stay valid) is encoded the same way into <card>/clips/pp-<id>.mp4 and the exercise's
`video:` line is rewritten to that file; nothing else in card.yaml changes. Running it again does nothing new.
`check` lists the local clips whose line is cut short at the edges (tools/clip_edges.py: playphrase.me cuts at the
subtitle, speech often runs past it). With --reject each such clip gets `skip:` in tools/playphrase-clips.yaml, its
exercises leave the card and its file is deleted; tools/playphrase.py then fills the card with the next clean clip.

The fragments are copyrighted films: personal study only.
"""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

import clip_edges
from human_audio import LIMIT_MARGIN_DB, TARGET_LUFS, TRUE_PEAK_DB
from playphrase_client import PlayPhraseClient, PlayPhraseError

CACHE_DIR = Path(__file__).resolve().parent / '.cache' / 'playphrase'
NOTES = Path(__file__).resolve().parent / 'playphrase-clips.yaml'
RAW_DIR = CACHE_DIR / 'raw'
LICENSE = '© rights holders · fragment via playphrase.me · personal study only'
NOTICE = ('Movie fragments are copyrighted by their rights holders and come via playphrase.me: '
          'personal study only, do not publish or share them.')
# Clips are served from playphrase.me itself or from its storage bucket; nothing else is downloaded.
VIDEO_URL = re.compile(
    r'^https://(www\.playphrase\.me/video/[a-z]{3}|s3\.[a-z0-9-]+\.wasabisys\.com/video-[a-z]+\.playphrase\.me/'
    r'[a-z-]+)/[0-9a-f]{24}/[0-9a-f]{24}\.mp4$'
)
CLIP_ID = re.compile(r'^[0-9a-f]{24}$')
CLIP_TEMPLATES = {'clip-type', 'clip-choice'}
LOCAL_VIDEO = re.compile(r'^clips/pp-[0-9a-f]{24}\.mp4$')
REQUEST_GAP_SECONDS = 1.5
PAGE_SIZE = 20
MAX_PAGES = 3
MIN_WORDS = 2
MAX_WORDS = 12
MAX_DURATION_MS = 6000
MIN_MEAN_SCORE = 0.75
MIN_SEARCHED_SCORE = 0.6
PROFANITY = re.compile(
    r"\b(fuck\w*|motherf\w*|shit\w*|bullshit|bitch\w*|cunt\w*|asshole\w*|arse\w*|bastard\w*|dick\w*|cock\w*|"
    r"puss(y|ies)|whore\w*|slut\w*|piss\w*|goddamn\w*|damn\w*|crap\w*|wank\w*|twat\w*|fag\w*|retard\w*|nigg\w*|"
    r"tits?|boobs?|porn\w*|horny)\b",
    re.IGNORECASE,
)
LINE_PAD_SECONDS = 0.25
PHRASE_PAD_SECONDS = 0.12
WIDTH, HEIGHT = 640, 360
MAX_FPS = 24
# CRF 30 first; a clip still over the target is encoded again a little softer.
CRF_STEPS = (30, 33, 36)
TARGET_BYTES = 180 * 1024
AUDIO_RATE = 48000
MP3_RATE = 44100


@dataclass
class Candidate:
    """A subtitle line of a film that passed the filters."""

    id: str
    """playphrase.me phrase id."""
    text: str
    """The line as subtitled."""
    title: str
    """Film credit: «Title (year)»."""
    imdb: str
    """IMDb id of the film, e.g. tt1242116."""
    url: str
    """IMDb page of the film."""
    video: str
    """Video URL on playphrase.me."""
    score: float
    """Mean recognition score of the words: how clearly the line is said."""
    words: list[list[Any]]
    """[[word, start s, end s], …] relative to the downloaded clip."""
    searched: list[int]
    """Indices of the words that matched the searched phrase."""


@dataclass
class Throttle:
    """Keeps requests to playphrase.me at least REQUEST_GAP_SECONDS apart."""

    last: float = 0.0
    """Monotonic time of the last request."""

    def wait(self) -> None:
        pause = REQUEST_GAP_SECONDS - (time.monotonic() - self.last)
        if pause > 0:
            time.sleep(pause)
        self.last = time.monotonic()


@dataclass
class Site:
    """The client with its throttle; the session opens only when something is not cached."""

    client: PlayPhraseClient = field(default_factory=PlayPhraseClient)
    """playphrase.me client."""
    throttle: Throttle = field(default_factory=Throttle)
    """Pause between requests."""


@dataclass
class Encoded:
    """A clip written to the card."""

    candidate: Candidate
    """What was fetched."""
    path: Path
    """The mp4 in <card>/clips/."""
    start: float
    """Where the trimmed file starts in the downloaded clip, in seconds."""
    crf: int
    """Quality the size target was met with (or the softest tried)."""


def card_dir(*, deck_dir: Path, card: str) -> Path:
    if not (deck_dir / 'deck.yaml').exists():
        raise SystemExit(f'{deck_dir}: no deck.yaml')
    folder = deck_dir / 'topics' / card
    if card.count('/') != 1 or not (folder / 'card.yaml').exists():
        raise SystemExit(f'{card}: no card {folder}/card.yaml (use topic/card)')
    return folder


def cache_path(*, query: str, skip: int) -> Path:
    slug = re.sub(r'[^a-z0-9]+', '-', query.lower()).strip('-')[:40]
    digest = hashlib.sha1(f'{query}|{PAGE_SIZE}|{skip}'.encode()).hexdigest()[:8]
    return CACHE_DIR / f'clips-{slug}-{skip}-{digest}.json'


def cached_search(*, site: Site, query: str, skip: int) -> dict[str, Any]:
    path = cache_path(query=query, skip=skip)
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    site.throttle.wait()
    found = site.client.search(query=query, limit=PAGE_SIZE, skip=skip)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(found, ensure_ascii=False), encoding='utf-8')
    return found


def credit(info: str) -> str:
    """«The Lion Sleeps Tonight (2008) [00:44:04]» → «The Lion Sleeps Tonight (2008)»."""
    return re.sub(r'\s*\[[\d:]+\]\s*$', '', info).strip()


def text_key(text: str) -> str:
    return ' '.join(re.sub(r'[^a-z0-9 ]+', '', text.lower().replace('’', "'").replace("'", '')).split())


def phrase_words(*, words: list[dict[str, Any]], phrase: str) -> list[int]:
    """Indices of the phrase in the line; the words the site marked as searched when it is not there word for word."""
    wanted, said = text_key(phrase).split(), [text_key(str(w.get('text', ''))) for w in words]
    start = next((i for i in range(len(said)) if said[i:i + len(wanted)] == wanted), -1)
    if start >= 0:
        return list(range(start, start + len(wanted)))
    return [i for i, w in enumerate(words) if w.get('searched?')]


def to_candidate(*, found: dict[str, Any], phrase: str) -> Candidate:
    words = found.get('words') or []
    scores = [float(w.get('score') or 0) for w in words]
    info = found.get('video-info') or {}
    return Candidate(
        id=str(found.get('id', '')), text=' '.join(str(found.get('text', '')).split()),
        title=credit(str(info.get('info', ''))), imdb=str(info.get('imdb', '')), url=str(info.get('source-url', '')),
        video=str(found.get('video-url', '')), score=round(sum(scores) / len(scores), 3) if scores else 0.0,
        words=[[w['text'], round(w['start'] / 1000, 3), round(w['end'] / 1000, 3)] for w in words],
        searched=phrase_words(words=words, phrase=phrase),
    )


def duration_ms(found: dict[str, Any]) -> int:
    last_word = int((found.get('words') or [{}])[-1].get('end', 0))
    return max(int(found.get('end', 0)) - int(found.get('start', 0)), last_word)


def rejection(*, found: dict[str, Any], phrase: str) -> str:
    """Why a search result is not a candidate; empty when it is one."""
    candidate = to_candidate(found=found, phrase=phrase)
    searched_scores = [float(found['words'][i].get('score') or 0) for i in candidate.searched]
    checks = [
        ((found.get('content-safety') or {}).get('sensitive?'), 'sensitive'),
        (not MIN_WORDS <= len(candidate.words) <= MAX_WORDS, f'{len(candidate.words)} words'),
        (duration_ms(found) > MAX_DURATION_MS, 'longer than 6 s'),
        (candidate.score < MIN_MEAN_SCORE, f'unclear speech ({candidate.score:.2f})'),
        (not searched_scores or min(searched_scores) < MIN_SEARCHED_SCORE, 'phrase said unclearly'),
        (PROFANITY.search(candidate.text), 'profanity'),
        (not CLIP_ID.match(candidate.id) or not VIDEO_URL.match(candidate.video), 'no video'),
        (not candidate.title, 'no credit'),
    ]
    return next((reason for failed, reason in checks if failed), '')


def spread_movies(*, candidates: list[Candidate], limit: int) -> list[Candidate]:
    """Clearest lines first, one per film per round, so the picks come from as many films as possible."""
    by_movie: dict[str, list[Candidate]] = {}
    for candidate in sorted(candidates, key=lambda c: -c.score):
        by_movie.setdefault(candidate.imdb or candidate.title, []).append(candidate)
    rounds = max((len(group) for group in by_movie.values()), default=0)
    ordered = [group[i] for i in range(rounds) for group in by_movie.values() if i < len(group)]
    return ordered[:limit]


@dataclass
class Harvest:
    """What the pages of one phrase gave so far."""

    phrase: str
    """The searched phrase."""
    accepted: dict[str, Candidate] = field(default_factory=dict)
    """Candidates by their normalised text: one per line."""
    reasons: dict[str, int] = field(default_factory=dict)
    """How many lines each filter dropped ('' counts the kept ones)."""

    def take(self, page: dict[str, Any]) -> None:
        for found in page.get('phrases') or []:
            key = text_key(str(found.get('text', '')))
            reason = rejection(found=found, phrase=self.phrase) or ('duplicate' if key in self.accepted else '')
            self.reasons[reason] = self.reasons.get(reason, 0) + 1
            if not reason:
                self.accepted[key] = to_candidate(found=found, phrase=self.phrase)

    def movies(self) -> int:
        return len({c.imdb or c.title for c in self.accepted.values()})


def next_pages(*, page: dict[str, Any], query: str, skip: int) -> list[list[Any]]:
    """The next page of the same query; when the site serves no more (anonymous visitors get one short page),
    its suggestions — the phrase with the word that follows it most often."""
    next_skip = int(page.get('next-skip') or 0)
    if page.get('have-next?') and next_skip > skip:
        return [[query, next_skip]]
    return [[str(s['value']), 0] for s in page.get('suggestions') or [] if s.get('value')]


def search_candidates(*, site: Site, phrase: str, limit: int) -> list[Candidate]:
    harvest = Harvest(phrase=phrase)
    queue, asked = [[phrase, 0]], []
    while queue and len(asked) < MAX_PAGES and harvest.movies() < limit:
        query, skip = queue.pop(0)
        page = cached_search(site=site, query=query, skip=skip)
        asked.append(query if skip == 0 else f'{query} (from {skip})')
        harvest.take(page)
        queue += [p for p in next_pages(page=page, query=query, skip=skip) if p not in queue]
    reasons = dict(harvest.reasons)
    print(f'asked: {"; ".join(asked)}')
    print(f'{sum(reasons.values())} lines looked at, {reasons.pop("", 0)} kept; dropped: {reasons or "none"}')
    return spread_movies(candidates=list(harvest.accepted.values()), limit=limit)


def write_candidates(*, path: Path, card: str, phrase: str, candidates: list[Candidate]) -> None:
    rows = [vars(candidate) for candidate in candidates]
    body = yaml.safe_dump({'card': card, 'phrase': phrase, 'clips': rows}, allow_unicode=True, sort_keys=False,
                          width=1000, default_flow_style=None)
    path.write_text(body, encoding='utf-8')


def run_search(args: argparse.Namespace) -> None:
    card_dir(deck_dir=args.deck, card=args.card)
    candidates = search_candidates(site=Site(), phrase=args.phrase, limit=args.max)
    out = args.out or Path(f'candidates-{re.sub(r"[^a-z0-9]+", "-", args.phrase.lower()).strip("-")}.yaml')
    write_candidates(path=out, card=args.card, phrase=args.phrase, candidates=candidates)
    for candidate in candidates:
        print(f'  {candidate.id}  {candidate.score:.2f}  {candidate.text}  — {candidate.title}')
    print(f'{len(candidates)} candidates → {out}')


def raw_video(*, site: Site, clip_id: str, url: str) -> Path:
    """The clip as playphrase.me serves it, downloaded once into RAW_DIR."""
    if not CLIP_ID.match(clip_id) or not VIDEO_URL.match(url):
        raise SystemExit(f'{clip_id}: not a playphrase.me clip ({url})')
    path = RAW_DIR / f'{clip_id}.mp4'
    if not path.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        site.throttle.wait()
        site.client.download_video(video_url=url, dest=path.with_suffix('.part'))
        path.with_suffix('.part').rename(path)
    return path


def raw_clip(*, site: Site, candidate: Candidate) -> Path:
    return raw_video(site=site, clip_id=candidate.id, url=candidate.video)


def probe(source: Path) -> dict[str, Any]:
    command = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,r_frame_rate']
    return json.loads(subprocess.run([*command, '-of', 'json', str(source)], capture_output=True, text=True,
                                     check=True).stdout)


def frame_rate(info: dict[str, Any]) -> float:
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    numerator, _, denominator = video['r_frame_rate'].partition('/')
    return float(numerator) / float(denominator or 1)


def measured_gain(*, source: Path, audio_filter: str) -> float:
    """First loudnorm pass: how far the cut is from the target loudness."""
    chain = f'{audio_filter},loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DB}:print_format=json'
    log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(source), '-af', chain, '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stderr
    measured = float(json.loads(log[log.rindex('{'):log.rindex('}') + 1])['input_i'])
    return TARGET_LUFS - measured if measured > -70 else 0.0


def levelled(*, source: Path, span: list[float] | None, rate: int) -> str:
    """Mono cut (the whole clip when span is None) at the target loudness; peaks held under the true-peak ceiling by a
    limiter on 4× oversampled audio."""
    trim = f'atrim={span[0]:.3f}:{span[1]:.3f},asetpts=PTS-STARTPTS,' if span else ''
    cut = f'{trim}aformat=channel_layouts=mono'
    gain = measured_gain(source=source, audio_filter=cut)
    limit = 10 ** ((TRUE_PEAK_DB - LIMIT_MARGIN_DB) / 20)
    return f'{cut},volume={gain:.2f}dB,aresample={rate * 4},alimiter=limit={limit:.3f}:level=disabled,aresample={rate}'


def encode_video(*, source: Path, target: Path, span: list[float] | None, crf: int) -> None:
    """Encodes span (seconds) of the source, or all of it when span is None, so word timings stay as they are."""
    fps = f',fps={MAX_FPS}' if frame_rate(probe(source)) > MAX_FPS + 0.01 else ''
    scale = f'scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2'
    trim = f'trim={span[0]:.3f}:{span[1]:.3f},setpts=PTS-STARTPTS,' if span else ''
    video = f'[0:v]{trim}{scale}{fps},format=yuv420p[v]'
    audio = f'[0:a]{levelled(source=source, span=span, rate=AUDIO_RATE)}[a]'
    command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(source), '-filter_complex', f'{video};{audio}']
    command += ['-map', '[v]', '-map', '[a]', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1']
    command += ['-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-c:a', 'aac', '-b:a', '64k', '-ac', '1']
    subprocess.run([*command, '-movflags', '+faststart', str(target)], check=True)


def line_span(*, candidate: Candidate, source: Path) -> list[float]:
    duration = float(probe(source)['format']['duration'])
    start = max(0.0, candidate.words[0][1] - LINE_PAD_SECONDS)
    return [round(start, 3), round(min(duration, candidate.words[-1][2] + LINE_PAD_SECONDS), 3)]


def encode_small(*, source: Path, target: Path, span: list[float] | None) -> int:
    """Writes the smallest acceptable encoding: CRF 30, softer only while over TARGET_BYTES. Returns the CRF used."""
    for crf in CRF_STEPS:
        with tempfile.TemporaryDirectory() as scratch:
            draft = Path(scratch) / 'clip.mp4'
            encode_video(source=source, target=draft, span=span, crf=crf)
            target.write_bytes(draft.read_bytes())
        if target.stat().st_size <= TARGET_BYTES:
            break
    return crf


def encode_clip(*, site: Site, candidate: Candidate, folder: Path) -> Encoded:
    source = raw_clip(site=site, candidate=candidate)
    span = line_span(candidate=candidate, source=source)
    target = folder / f'pp-{candidate.id}.mp4'
    crf = encode_small(source=source, target=target, span=span)
    return Encoded(candidate=candidate, path=target, start=span[0], crf=crf)


def phrase_span(candidate: Candidate) -> list[float]:
    """The searched words with a little air, but never into the word before or after them."""
    words, first, last = candidate.words, candidate.searched[0], candidate.searched[-1]
    before = words[first - 1][2] if first > 0 else 0.0
    after = words[last + 1][1] if last + 1 < len(words) else words[last][2] + PHRASE_PAD_SECONDS
    return [max(before, words[first][1] - PHRASE_PAD_SECONDS), min(after, words[last][2] + PHRASE_PAD_SECONDS)]


def cut_phrase(*, candidate: Candidate, target: Path) -> None:
    source = RAW_DIR / f'{candidate.id}.mp4'
    start, end = phrase_span(candidate)
    chain = levelled(source=source, span=[start, end], rate=MP3_RATE)
    command = ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(source), '-vn', '-sn', '-af', chain, '-ac', '1']
    command += ['-ar', str(MP3_RATE), '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', str(target)]
    subprocess.run(command, check=True)


def whisper_heard(path: Path) -> str:
    # Imported here: Whisper runs on Apple Silicon only, and search and fetch work without it.
    import mlx_whisper

    from voice_judge import WHISPER_MODEL

    return mlx_whisper.transcribe(str(path), path_or_hf_repo=WHISPER_MODEL, language='en')['text'].strip()


def check_phrase(*, candidate: Candidate, phrase: str, folder: Path) -> str:
    """Cuts the searched words to pp-<id>.phrase.mp3 and keeps the file only if Whisper hears the phrase."""
    from voice_judge import words_match

    if not candidate.searched:
        return 'no searched words, no phrase audio'
    target = folder / f'pp-{candidate.id}.phrase.mp3'
    cut_phrase(candidate=candidate, target=target)
    heard = whisper_heard(target)
    if words_match(heard=heard, expected=phrase):
        return f'phrase audio kept ({target.stat().st_size // 1024} KB): Whisper heard «{heard}»'
    target.unlink()
    return f'phrase audio dropped: Whisper heard «{heard}», not «{phrase}»'


def loudness(path: Path) -> str:
    command = ['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-']
    summary = subprocess.run(command, capture_output=True, text=True, check=True).stderr.rpartition('Summary:')[2]
    integrated = re.search(r'I:\s+(-?[\d.]+) LUFS', summary)
    peak = re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', summary)
    return f'{integrated.group(1) if integrated else "?"} LUFS, true peak {peak.group(1) if peak else "?"} dBTP'


def snippet(encoded: Encoded) -> str:
    candidate, shift = encoded.candidate, encoded.start
    words = [[w[0], round(max(0.0, w[1] - shift), 2), round(max(0.0, w[2] - shift), 2)] for w in candidate.words]
    source = {'name': candidate.title, 'url': candidate.url, 'license': LICENSE}
    body = {'media': f'clips/{encoded.path.name}', 'text': candidate.text, 'words': words, 'source': source}
    return 'clip: ' + json.dumps(body, ensure_ascii=False, separators=(', ', ': '))


def load_candidates(*, path: Path, ids: list[str]) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    clips = [Candidate(**row) for row in data.get('clips') or []]
    unknown = sorted(set(ids) - {c.id for c in clips})
    if unknown:
        raise SystemExit(f'not in {path}: {", ".join(unknown)}')
    return {**data, 'clips': [c for c in clips if not ids or c.id in ids]}


def run_fetch(args: argparse.Namespace) -> None:
    data = load_candidates(path=args.candidates, ids=args.ids or [])
    folder = card_dir(deck_dir=args.deck, card=data['card']) / 'clips'
    folder.mkdir(exist_ok=True)
    site = Site()
    for candidate in data['clips']:
        encoded = encode_clip(site=site, candidate=candidate, folder=folder)
        size = encoded.path.stat().st_size
        over = '' if size <= TARGET_BYTES else f' — over the {TARGET_BYTES // 1024} KB target'
        print(f'\n{encoded.path} · {size / 1024:.0f} KB (CRF {encoded.crf}){over} · {loudness(encoded.path)}')
        if args.audio_phrase:
            print(check_phrase(candidate=candidate, phrase=data['phrase'], folder=folder))
        print(snippet(encoded))


def linked_clips(card: dict[str, Any]) -> dict[str, str]:
    """{phrase id: video URL} of the card's clip exercises that still stream from playphrase.me."""
    linked = {}
    for exercise in card.get('exercises') or []:
        url = str((exercise.get('params') or {}).get('video') or '')
        if exercise.get('template') in CLIP_TEMPLATES and VIDEO_URL.match(url):
            linked[url.rsplit('/', 1)[1].removesuffix('.mp4')] = url
    return linked


def relink(*, text: str, linked: dict[str, str]) -> str:
    """Points each `video:` line with a linked URL at its local file; every other byte of card.yaml stays."""
    for clip_id, url in linked.items():
        line = re.compile(rf'^(\s*(?:- )?video:[ \t]*)([\'"]?){re.escape(url)}\2([ \t]*)$', re.MULTILINE)
        text = line.sub(lambda m, i=clip_id: f'{m.group(1)}clips/pp-{i}.mp4{m.group(3)}', text)
    return text


def check_relinked(*, before: dict[str, Any], after: dict[str, Any], path: Path) -> None:
    """Only the video values may differ: the same exercises, params and progress otherwise."""
    def without_video(card: dict[str, Any]) -> dict[str, Any]:
        exercises = [{**e, 'params': {k: v for k, v in (e.get('params') or {}).items() if k != 'video'}}
                     for e in card.get('exercises') or []]
        return {**card, 'exercises': exercises}

    if without_video(before) != without_video(after) or linked_clips(after):
        raise SystemExit(f'{path}: relinking would change more than the video lines; card left as it was')


def localize_card(*, site: Site, path: Path) -> list[Path]:
    """Downloads and encodes every linked clip of a card into its clips/ (whole clip: the word timings in ms stay
    valid) and rewrites those exercises' `video:` to clips/pp-<id>.mp4. Returns the card's local clip files."""
    text = path.read_text(encoding='utf-8')
    card = yaml.safe_load(text) or {}
    linked = linked_clips(card)
    folder = path.parent / 'clips'
    for clip_id, url in linked.items():
        target = folder / f'pp-{clip_id}.mp4'
        if target.exists():
            continue
        folder.mkdir(exist_ok=True)
        source = raw_video(site=site, clip_id=clip_id, url=url)
        crf = encode_small(source=source, target=target, span=None)
        print(f'  {target} · {target.stat().st_size / 1024:.0f} KB (CRF {crf}) · {loudness(target)}')
    if linked:
        new_text = relink(text=text, linked=linked)
        check_relinked(before=card, after=yaml.safe_load(new_text) or {}, path=path)
        path.write_text(new_text, encoding='utf-8')
    local = {str((e.get('params') or {}).get('video') or '') for e in card.get('exercises') or []}
    local |= {f'clips/pp-{clip_id}.mp4' for clip_id in linked}
    return sorted(path.parent / v for v in local if LOCAL_VIDEO.match(v))


def deck_cards(*, deck_dir: Path, wanted: list[str]) -> list[Path]:
    """card.yaml files of the deck; with wanted, only those (card id or topic/id)."""
    if not (deck_dir / 'deck.yaml').exists():
        raise SystemExit(f'{deck_dir}: no deck.yaml')
    paths = sorted(deck_dir.glob('topics/*/*/card.yaml'))
    keys = {path: (f'{path.parent.parent.name}/{path.parent.name}', path.parent.name) for path in paths}
    unknown = [w for w in wanted if not any(w in key for key in keys.values())]
    if unknown:
        raise SystemExit(f'no card {", ".join(unknown)}')
    return [path for path in paths if not wanted or set(keys[path]) & set(wanted)]


def localize(*, deck_dir: Path, wanted: list[str]) -> None:
    site = Site()
    files: set[Path] = set()
    wanted = [w.strip() for item in wanted for w in item.split(',') if w.strip()]
    for path in deck_cards(deck_dir=deck_dir, wanted=wanted):
        files |= set(localize_card(site=site, path=path))
    size = sum(f.stat().st_size for f in files if f.exists())
    print(f'{len(files)} local clips, {size / 1024:.0f} KB in all')


@dataclass
class CutClip:
    """A local clip of a card whose line is cut short."""

    path: Path
    """card.yaml."""
    video: str
    """clips/pp-<id>.mp4 as the exercises name it."""
    text: str
    """The line."""
    cut: str
    """What is cut off (Russian)."""


def cut_clips(path: Path) -> list[CutClip]:
    card = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    lines = {}
    for exercise in card.get('exercises') or []:
        params = exercise.get('params') or {}
        if exercise.get('template') in CLIP_TEMPLATES and LOCAL_VIDEO.match(str(params.get('video') or '')):
            lines.setdefault(params['video'], params['text'])
    found = []
    for video, text in lines.items():
        cut = clip_edges.check(video=path.parent / video, text=text).cut
        if cut:
            found.append(CutClip(path=path, video=video, text=text, cut=cut))
    return found


def exercise_items(lines: list[str]) -> list[tuple[int, int]]:
    """[start, end) line ranges of the items of the card's top-level exercises list."""
    start = next(i for i, line in enumerate(lines) if line.startswith('exercises:'))
    end = next((i for i in range(start + 1, len(lines)) if re.match(r'^[A-Za-z_]', lines[i])), len(lines))
    first = next(line for line in lines[start + 1:end] if line.lstrip().startswith('- '))
    marker = first[:len(first) - len(first.lstrip())] + '- '
    heads = [i for i in range(start + 1, end) if lines[i].startswith(marker)]
    return list(zip(heads, [*heads[1:], end]))


def drop_clip(*, path: Path, video: str) -> None:
    """Removes the exercises of one clip from card.yaml line by line (every other line, progress too, stays)."""
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines()
    pattern = re.compile(rf'^\s*video:[ \t]*([\'"]?){re.escape(video)}\1[ \t]*$')
    drop = {i for a, b in exercise_items(lines) if any(pattern.match(line) for line in lines[a:b]) for i in range(a, b)}
    kept = '\n'.join(line for i, line in enumerate(lines) if i not in drop) + '\n'
    before, after = yaml.safe_load(text), yaml.safe_load(kept)
    expected = [e for e in before['exercises'] if (e.get('params') or {}).get('video') != video]
    if after['exercises'] != expected or {**before, 'exercises': []} != {**after, 'exercises': []}:
        raise SystemExit(f'{path}: removing {video} would change more than its exercises; card left as it was')
    path.write_text(kept, encoding='utf-8')
    (path.parent / video).unlink(missing_ok=True)


def skip_note(*, clip_id: str, reason: str) -> None:
    """`skip:` for the clip in the notes, under its entry or as a new one at the end of `clips:`."""
    lines = NOTES.read_text(encoding='utf-8').splitlines()
    head = next((i for i, line in enumerate(lines) if line == f'  {clip_id}:'), None)
    if head is None:
        lines += [f'  {clip_id}:', f'    skip: {json.dumps(reason, ensure_ascii=False)}']
    elif not any(line.startswith('    skip:') for line in lines[head + 1:head + 2]):
        lines.insert(head + 1, f'    skip: {json.dumps(reason, ensure_ascii=False)}')
    NOTES.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def check_cards(*, deck_dir: Path, wanted: list[str], reject: bool) -> None:
    wanted = [w.strip() for item in wanted for w in item.split(',') if w.strip()]
    found = [cut for path in deck_cards(deck_dir=deck_dir, wanted=wanted) for cut in cut_clips(path)]
    for cut in found:
        print(f'  {cut.path.parent.parent.name}/{cut.path.parent.name}: «{cut.text}» — {cut.cut}')
        if reject:
            clip_id = cut.video.removeprefix('clips/pp-').removesuffix('.mp4')
            skip_note(clip_id=clip_id, reason=f'реплика обрезана ({cut.cut})')
            drop_clip(path=cut.path, video=cut.video)
    print(f'{len(found)} clips cut short' + (', rejected' if reject and found else ''))


def main() -> None:
    parser = argparse.ArgumentParser(description='Short movie fragments from playphrase.me for a card.')
    commands = parser.add_subparsers(dest='command', required=True)
    search = commands.add_parser('search', help='find clean, clearly spoken lines with a phrase')
    search.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    search.add_argument('--card', required=True, help='topic/card the clips are for')
    search.add_argument('--phrase', required=True, help='phrase to search for')
    search.add_argument('--max', type=int, default=6, help='candidates to keep (default 6)')
    search.add_argument('--out', type=Path, default=None, help='candidates file (default candidates-<phrase>.yaml)')
    fetch = commands.add_parser('fetch', help='download, trim and encode chosen candidates into <card>/clips/')
    fetch.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    fetch.add_argument('candidates', type=Path, help='file written by search')
    fetch.add_argument('--ids', nargs='+', default=None, help='candidate ids to fetch (default: all)')
    fetch.add_argument('--audio-phrase', action='store_true',
                       help='also cut the phrase to mp3 and check it with Whisper')
    local = commands.add_parser('localize', help='copy linked clip exercises into <card>/clips/ and point them there')
    local.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    local.add_argument('--cards', nargs='+', default=[], help='card ids or topic/id (default: every card)')
    check = commands.add_parser('check', help='list local clips whose line is cut short at the edges')
    check.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    check.add_argument('--cards', nargs='+', default=[], help='card ids or topic/id (default: every card)')
    check.add_argument('--reject', action='store_true',
                       help='skip such clips in the notes and take their exercises and files out of the cards')
    args = parser.parse_args()
    print(NOTICE)
    try:
        if args.command == 'search':
            run_search(args)
        elif args.command == 'fetch':
            run_fetch(args)
        elif args.command == 'check':
            check_cards(deck_dir=args.deck, wanted=args.cards, reject=args.reject)
        else:
            localize(deck_dir=args.deck, wanted=args.cards)
    except PlayPhraseError as error:
        raise SystemExit(f'playphrase.me: {error}') from error


if __name__ == '__main__':
    main()
