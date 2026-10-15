"""zoobrik-playphrase: listening exercises on short movie clips from playphrase.me.

The deck keeps the clip's subtitle line with word timings and the film credit, and the video itself: with --localize
(or later `tools/clips.py localize`) a compressed, loudness-levelled copy in <card>/clips/pp-<id>.mp4, otherwise the
playphrase.me URL the app streams. The copies are for personal study only and never leave the deck.

Searches go through tools/playphrase_client.py (an anonymous session opened like a browser visit, kept in memory
only), at most one every two seconds; every response is cached under tools/.cache/playphrase/ and a
cached query is never sent again. The Russian side (translations, explanations, wrong options) is authored by hand in
tools/playphrase-clips.yaml; a clip without notes is listed in tools/.cache/playphrase/todo.yaml and skipped.
"""

import argparse
import hashlib
import json
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

WEB_DIR = Path(__file__).resolve().parent.parent / 'web'
CACHE_DIR = Path(__file__).resolve().parent / '.cache' / 'playphrase'
NOTES = Path(__file__).resolve().parent / 'playphrase-clips.yaml'
VIDEO_URL = re.compile(r'^https://www\.playphrase\.me/video/[a-z]{3}/[0-9a-f]+/[0-9a-f]+\.mp4$')
# The API may hand out the storage bucket's address; the deck keeps the site's own path to the same file.
STORAGE_URL = re.compile(r'^https://s3\.[a-z0-9-]+\.wasabisys\.com/video-[a-z]+\.playphrase\.me/english-storage/'
                         r'([0-9a-f]+/[0-9a-f]+\.mp4)$')
SEARCH_GAP_SECONDS = 2.0
MIN_WORDS = 3
MAX_WORDS = 14
MAX_DURATION_MS = 7000
MAX_TEXT_LENGTH = 90
MIN_SCORE = 0.6
DICTATION_MAX_WORDS = 8
QUERIES_PER_CARD = 3
QUESTION = 'Что сказал герой?'


class SessionClosed(Exception):
    """playphrase.me refused the search (e.g. "Old page, reload" even after a fresh session)."""


@dataclass
class Searcher:
    """Polite, cached search: one request per two seconds, a budget, no repeated queries."""

    budget: int
    """How many requests this run may still send."""
    client: Any = None
    """playphrase_client.PlayPhraseClient, opened on the first request that is not cached."""
    last: float = 0.0
    """Monotonic time of the last request."""
    sent: int = 0
    """Requests sent in this run."""
    closed: bool = False
    """The site refused the session: only cached answers from now on."""


@dataclass
class Clip:
    """One subtitle line of a film with its video."""

    id: str
    """playphrase.me phrase id."""
    movie: str
    """playphrase.me movie id."""
    video: str
    """Video URL on playphrase.me (downloaded and encoded by --localize)."""
    text: str
    """The line as subtitled."""
    words: list[list[Any]]
    """[[word, start ms, end ms], …] relative to the clip."""
    title: str
    """Film credit: «Title (year)»."""
    url: str
    """IMDb page of the film."""
    score: float
    """Average recognition score of the words: how clearly the line is said."""


@dataclass
class CardRef:
    """A card of the deck the tool may add clips to."""

    key: str
    """topic/id."""
    path: Path
    """card.yaml."""
    data: dict[str, Any]
    """Parsed card.yaml."""


@dataclass
class Pick:
    """A clip chosen for a card, with the words it trains."""

    card: CardRef
    """The card."""
    clip: Clip
    """The clip."""
    focus: str
    """The target words exactly as they appear in the line."""
    rejected: list[str] = field(default_factory=list)
    """Why other candidates were dropped (for the report)."""


def cache_path(query: str) -> Path:
    slug = re.sub(r'[^a-z0-9]+', '-', query.lower()).strip('-')[:40]
    return CACHE_DIR / f'{slug}-{hashlib.sha1(query.encode()).hexdigest()[:8]}.json'


def wait_turn(searcher: Searcher) -> None:
    pause = SEARCH_GAP_SECONDS - (time.monotonic() - searcher.last)
    if pause > 0:
        time.sleep(pause)
    searcher.last = time.monotonic()
    searcher.sent += 1


def send(*, searcher: Searcher, query: str) -> dict[str, Any]:
    """One search through tools/playphrase_client.py (it reopens a stale session once by itself)."""
    # Imported here: the client needs requests, and runs on cached answers alone do not.
    from requests import RequestException

    from playphrase_client import PlayPhraseClient, PlayPhraseError

    if searcher.client is None:
        searcher.client = PlayPhraseClient()
    wait_turn(searcher)
    try:
        return searcher.client.search(query=query, limit=20)
    except (PlayPhraseError, RequestException) as error:
        raise SessionClosed(str(error)[:300]) from error


def search(*, searcher: Searcher, query: str) -> dict[str, Any] | None:
    path = cache_path(query)
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    if searcher.closed or searcher.sent >= searcher.budget:
        return None
    try:
        found = send(searcher=searcher, query=query)
    except SessionClosed as error:
        print(f'playphrase.me: {error}; searching stops, cached answers only')
        searcher.closed = True
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(found, ensure_ascii=False), encoding='utf-8')
    return found


def credit(info: str) -> str:
    """«The Lion Sleeps Tonight (2008) [00:44:04]» → «The Lion Sleeps Tonight (2008)»."""
    return re.sub(r'\s*\[[\d:]+\]\s*$', '', info).strip()


def site_url(url: str) -> str:
    storage = STORAGE_URL.match(url)
    return f'https://www.playphrase.me/video/eng/{storage.group(1)}' if storage else url


def to_clip(phrase: dict[str, Any]) -> Clip:
    words = [[w['text'], int(w['start']), int(w['end'])] for w in phrase.get('words') or []]
    scores = [float(w.get('score') or 0) for w in phrase.get('words') or []]
    info = phrase.get('video-info') or {}
    return Clip(
        id=phrase['id'], movie=phrase.get('movie', ''), video=site_url(phrase.get('video-url', '')),
        text=phrase.get('text', '').strip(),
        words=words, title=credit(info.get('info', '')), url=info.get('source-url', ''),
        score=sum(scores) / len(scores) if scores else 0.0,
    )


def unusable(phrase: dict[str, Any]) -> str:
    """Why a search result cannot become an exercise; empty when it can."""
    clip = to_clip(phrase)
    if (phrase.get('content-safety') or {}).get('sensitive?'):
        return 'sensitive'
    if phrase.get('overlong') or len(clip.text) > MAX_TEXT_LENGTH:
        return 'overlong'
    if not MIN_WORDS <= len(clip.words) <= MAX_WORDS:
        return f'{len(clip.words)} words'
    if int(phrase.get('end', 0)) - int(phrase.get('start', 0)) > MAX_DURATION_MS:
        return 'longer than 7 s'
    if clip.score < MIN_SCORE:
        return f'unclear speech ({clip.score:.2f})'
    if not VIDEO_URL.match(clip.video) or not clip.title:
        return 'no video or credit'
    return ''


def focus_in(*, text: str, query: str) -> str:
    """The query as written in the line (case kept), or empty when the line does not contain it as whole words."""
    found = re.search(rf'(?<![\w\'’]){re.escape(query)}(?![\w\'’])', text, re.IGNORECASE)
    return found.group(0) if found else ''


def load_cards(deck_dir: Path) -> dict[str, CardRef]:
    cards = {}
    for path in sorted(deck_dir.glob('topics/*/*/card.yaml')):
        data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
        key = f'{path.parent.parent.name}/{data.get("id", path.parent.name)}'
        cards[key] = CardRef(key=key, path=path, data=data)
    return cards


def choose_cards(*, cards: dict[str, CardRef], ids: list[str], topics: list[str]) -> list[CardRef]:
    chosen = [c for c in cards.values() if c.key.split('/')[0] in topics]
    for wanted in ids:
        match = [c for key, c in cards.items() if wanted in (key, key.split('/')[1])]
        if not match:
            raise SystemExit(f'no card {wanted}')
        chosen += [c for c in match if c not in chosen]
    active = [c for c in chosen if any(e.get('status') != 'off' for e in c.data.get('exercises') or [])]
    return [c for c in active if c.data.get('kind') != 'listening']


def rule_phrases(card: CardRef) -> list[str]:
    """Phrases of the card's examples its detect patterns find, with the next word when the match is a single word."""
    found: list[str] = []
    for example in (card.data.get('content') or {}).get('examples') or []:
        text = str(example.get('en') or example.get('term') or '').rstrip('.!?')
        for pattern in card.data.get('detect') or []:
            try:
                match = re.search(pattern, text, re.IGNORECASE)
            except re.error:
                # A JavaScript pattern Python cannot run (a look-behind of varying width): `queries:` cover the card.
                continue
            if not match:
                continue
            phrase = match.group(0).strip()
            if ' ' not in phrase:
                tail = re.match(r"\s+([\w']+)", text[match.end():])
                phrase = f'{phrase} {tail.group(1)}' if tail else phrase
            if phrase.lower() not in (f.lower() for f in found):
                found.append(phrase)
    return found


def card_queries(*, card: CardRef, notes: dict[str, Any]) -> list[str]:
    own = (notes.get('queries') or {}).get(card.data.get('id'))
    if own:
        return list(own)
    if card.data.get('kind') == 'grammar':
        return rule_phrases(card)[:QUERIES_PER_CARD]
    term = str((card.data.get('content') or {}).get('en') or '')
    return [term] if term else []


def candidates(*, searcher: Searcher, card: CardRef, notes: dict[str, Any]) -> list[tuple[Clip, str]]:
    """Usable clips of the card's queries; when the first query gives few, its suggestions are searched too."""
    queries = card_queries(card=card, notes=notes)
    out: list[tuple[Clip, str]] = []
    seen: set[str] = set()
    while queries and len(seen) < QUERIES_PER_CARD * 2:
        query = queries.pop(0)
        found = search(searcher=searcher, query=query)
        seen.add(query)
        if not found:
            continue
        for phrase in found.get('phrases') or []:
            focus = focus_in(text=phrase.get('text', ''), query=query)
            if focus and not unusable(phrase) and all(c.id != phrase['id'] for c, _ in out):
                out.append((to_clip(phrase), focus))
        if len(out) < 4 and len(seen) < QUERIES_PER_CARD and card.data.get('kind') != 'grammar':
            queries += [s['value'] for s in found.get('suggestions') or [] if s.get('value') not in seen][:1]
    return out


def prerequisites(*, deck_dir: Path, items: list[dict[str, Any]], assume_top: int) -> dict[str, dict[str, Any]]:
    """Runs web/scripts/clips-filter.ts: unknown words and untaught rules of each line at its card's teaching step."""
    if not items:
        return {}
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    request = CACHE_DIR / 'filter-in.json'
    request.write_text(json.dumps(items, ensure_ascii=False), encoding='utf-8')
    command = ['npx', 'tsx', 'scripts/clips-filter.ts', str(deck_dir.resolve()), str(request)]
    command += ['--assume-top', str(assume_top)]
    done = subprocess.run(command, cwd=WEB_DIR, capture_output=True, text=True, check=True)
    return {row['key']: row for row in json.loads(done.stdout)}


def best(*, clips: list[tuple[Clip, str]], count: int) -> list[tuple[Clip, str]]:
    """Shortest and clearest first, one clip per film."""
    ranked = sorted(clips, key=lambda item: (len(item[0].words), -item[0].score))
    chosen: list[tuple[Clip, str]] = []
    for clip, focus in ranked:
        if len(chosen) < count and all(clip.movie != other.movie for other, _ in chosen):
            chosen.append((clip, focus))
    return chosen


def bare(text: str) -> str:
    """The line without punctuation: what a learner types after hearing it."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s\'’-]|(?<!\w)-|-(?!\w)', ' ', text)).strip()


def media_params(clip: Clip) -> dict[str, Any]:
    return {
        'video': clip.video, 'text': clip.text, 'words': [FlowList(w) for w in clip.words],
        'source': {'title': clip.title, 'url': clip.url},
    }


def gap_exercise(*, pick: Pick, note: dict[str, Any], id_: str) -> dict[str, Any]:
    params = media_params(pick.clip) | {'answer': pick.focus, 'accept': [], 'gap': pick.focus}
    params |= {'translation': note['translation'], 'explanation': note['gap']}
    return {'id': id_, 'template': 'clip-type', 'skill': ['listen', 'spell'], 'status': 'ready', 'difficulty': 3,
            'params': params}


def dictation_exercise(*, pick: Pick, note: dict[str, Any], id_: str) -> dict[str, Any]:
    text = pick.clip.text
    accept = [bare(text)] if bare(text) != text else []
    params = media_params(pick.clip) | {'answer': text, 'accept': accept, 'focus': pick.focus}
    params |= {'translation': note['translation'], 'explanation': note['dictation']}
    return {'id': id_, 'template': 'clip-type', 'skill': ['listen', 'spell'], 'status': 'ready', 'difficulty': 4,
            'params': params}


def choice_exercise(*, pick: Pick, note: dict[str, Any], id_: str) -> dict[str, Any]:
    choice = note['choice']
    answer = choice.get('answer') or pick.clip.text
    params = media_params(pick.clip) | {'question': choice.get('question') or QUESTION, 'answer': answer}
    params |= {'options': [answer, *choice['wrong']], 'focus': pick.focus, 'translation': note['translation'],
               'explanation': choice['explanation']}
    return {'id': id_, 'template': 'clip-choice', 'skill': 'listen', 'status': 'ready', 'difficulty': 2,
            'params': params}


def clip_exercises(*, pick: Pick, note: dict[str, Any], first: int) -> list[dict[str, Any]]:
    """Gap on the target words, a dictation of a short line, a choice between near-identical lines."""
    makers = [gap_exercise]
    if len(pick.clip.words) <= DICTATION_MAX_WORDS and note.get('dictation'):
        makers.append(dictation_exercise)
    if note.get('choice'):
        makers.append(choice_exercise)
    return [make(pick=pick, note=note, id_=f'v{first + i}') for i, make in enumerate(makers)]


class FlowList(list):
    """Written as [a, b, c] on one line: the word timings."""


class CardDumper(yaml.SafeDumper):
    """Block style like the deck files; nested lists indented or not, as the card file does it."""

    indent_lists = True

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        return super().increase_indent(flow, False if self.indent_lists else indentless)


CardDumper.add_representer(
    FlowList, lambda dumper, data: dumper.represent_sequence('tag:yaml.org,2002:seq', data, flow_style=True),
)


def exercise_block(*, text: str) -> tuple[int, str]:
    """Where the exercises list ends in a card.yaml (line index) and how its items are indented ('' or '  ')."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith('exercises:'))
    end = next((i for i in range(start + 1, len(lines)) if re.match(r'^[A-Za-z_]', lines[i])), len(lines))
    while end > start + 1 and not lines[end - 1].strip():
        end -= 1
    first_item = next((line for line in lines[start + 1:end] if line.lstrip().startswith('- ')), '- ')
    return end, ' ' * (len(first_item) - len(first_item.lstrip()))


def append_exercises(*, path: Path, exercises: list[dict[str, Any]]) -> None:
    """Appends to the card's exercises list, keeping every existing line (and progress) as it is."""
    text = path.read_text(encoding='utf-8')
    end, indent = exercise_block(text=text)
    CardDumper.indent_lists = bool(indent)
    dumped = yaml.dump(exercises, Dumper=CardDumper, allow_unicode=True, sort_keys=False, width=120)
    block = [f'{indent}{line}' for line in dumped.splitlines()]
    lines = text.splitlines()
    path.write_text('\n'.join([*lines[:end], *block, *lines[end:]]) + '\n', encoding='utf-8')


def next_index(card: CardRef) -> int:
    ids = [str(e.get('id')) for e in card.data.get('exercises') or []]
    used = [int(m.group(1)) for i in ids if (m := re.fullmatch(r'v(\d+)', i))]
    return max(used, default=0) + 1


def todo_note(pick: Pick) -> dict[str, Any]:
    """A blank notes entry for a clip that has none yet."""
    return {
        'card': pick.card.data.get('id'), 'text': pick.clip.text, 'film': pick.clip.title, 'focus': pick.focus,
        'translation': '', 'gap': '', 'dictation': '',
        'choice': {'question': QUESTION, 'wrong': [], 'explanation': ''},
    }


def note_ready(note: dict[str, Any] | None) -> bool:
    return bool(note and note.get('translation') and note.get('gap'))


def clip_videos(card: CardRef) -> set[str]:
    """Clips the card already has (any exercise with a video)."""
    return {str(e['params']['video']) for e in card.data.get('exercises') or [] if (e.get('params') or {}).get('video')}


def room(*, card: CardRef, per_card: int) -> int:
    return max(0, per_card - len(clip_videos(card)))


def picks_for(*, card: CardRef, searcher: Searcher, notes: dict[str, Any], per_card: int) -> list[tuple[Clip, str]]:
    if not room(card=card, per_card=per_card):
        return []
    have = clip_videos(card)
    found = candidates(searcher=searcher, card=card, notes=notes)
    return [(clip, focus) for clip, focus in found if clip.video not in have]


def screen(*, deck_dir: Path, found: dict[str, list[tuple[Clip, str]]],
           assume_top: int) -> dict[str, list[tuple[Clip, str]]]:
    """Keeps lines whose words and rules the learner knows by the card's step."""
    items = [{'key': f'{key}#{clip.id}', 'card': key, 'texts': [clip.text]}
             for key, clips in found.items() for clip, _ in clips]
    verdicts = prerequisites(deck_dir=deck_dir, items=items, assume_top=assume_top)
    kept: dict[str, list[tuple[Clip, str]]] = {}
    for key, clips in found.items():
        for clip, focus in clips:
            row = verdicts.get(f'{key}#{clip.id}') or {}
            if row.get('unknown') or row.get('rules') or row.get('error'):
                why = [*(row.get('unknown') or []), *(row.get('rules') or []), *filter(None, [row.get('error')])]
                print(f'  {key}: drop «{clip.text}» — {", ".join(why)}')
            else:
                kept.setdefault(key, []).append((clip, focus))
    return kept


def check_choices(*, deck_dir: Path, plans: list[tuple[Pick, list[dict[str, Any]]]], assume_top: int) -> None:
    """Drops a choice exercise whose wrong options use words or rules not taught by the card's step."""
    items = [{'key': f'{p.card.key}#{e["id"]}', 'card': p.card.key, 'texts': e['params']['options']}
             for p, exercises in plans for e in exercises if e['template'] == 'clip-choice']
    verdicts = prerequisites(deck_dir=deck_dir, items=items, assume_top=assume_top)
    for pick, exercises in plans:
        for exercise in list(exercises):
            row = verdicts.get(f'{pick.card.key}#{exercise["id"]}') or {}
            if row.get('unknown') or row.get('rules'):
                needs = row.get('unknown') or row.get('rules')
                print(f'  {pick.card.key} {exercise["id"]}: options need {needs}; choice skipped')
                exercises.remove(exercise)


def rejected(*, note: dict[str, Any] | None, card: str) -> bool:
    """True when the clip's note rejects it outright or for this card (the same line can mean another thing there)."""
    return bool(note and (note.get('skip') or card in (note.get('skip_cards') or [])))


def plan(*, chosen: dict[str, list[tuple[Clip, str]]], cards: dict[str, CardRef], notes: dict[str, Any],
         per_card: int) -> tuple[list[tuple[Pick, list[dict[str, Any]]]], list[dict[str, Any]]]:
    clip_notes = notes.get('clips') or {}
    plans, todo = [], []
    for key, clips in chosen.items():
        card = cards[key]
        index = next_index(card)
        # A clip its note rejects (offensive, another meaning, too hard) gives way to the next best one.
        usable = [(clip, focus) for clip, focus in clips if not rejected(note=clip_notes.get(clip.id), card=key)]
        for clip, focus in best(clips=usable, count=room(card=card, per_card=per_card)):
            pick = Pick(card=card, clip=clip, focus=focus)
            note = clip_notes.get(clip.id)
            if not note_ready(note):
                todo.append({clip.id: todo_note(pick)})
                continue
            exercises = clip_exercises(pick=pick, note=note, first=index)
            index += len(exercises)
            plans.append((pick, exercises))
    return plans, todo


def run(*, deck_dir: Path, targets: list[CardRef], per_card: int, budget: int, assume_top: int, dry_run: bool,
        localize: bool) -> None:
    notes = yaml.safe_load(NOTES.read_text(encoding='utf-8')) if NOTES.exists() else {}
    searcher = Searcher(budget=budget)
    cards = {c.key: c for c in targets}
    found = {c.key: picks_for(card=c, searcher=searcher, notes=notes or {}, per_card=per_card) for c in targets}
    print(f'{searcher.sent} searches sent, {sum(map(len, found.values()))} usable clips for {len(targets)} cards')
    chosen = screen(deck_dir=deck_dir, found={k: v for k, v in found.items() if v}, assume_top=assume_top)
    plans, todo = plan(chosen=chosen, cards=cards, notes=notes or {}, per_card=per_card)
    check_choices(deck_dir=deck_dir, plans=plans, assume_top=assume_top)
    if todo:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        listing = yaml.safe_dump(todo, allow_unicode=True, sort_keys=False, width=120)
        (CACHE_DIR / 'todo.yaml').write_text(listing, encoding='utf-8')
        print(f'{len(todo)} clips need notes in {NOTES.name}: see {CACHE_DIR / "todo.yaml"}')
    written = report(plans=plans, cards=targets, dry_run=dry_run)
    if localize and written:
        localize_cards(written)


def localize_cards(paths: list[Path]) -> None:
    """The clips just written are downloaded, encoded into <card>/clips/ and linked there (tools/clips.py localize)."""
    # Imported here: clips.py needs requests and ffmpeg, which searching does not.
    import clips

    site, files = clips.Site(), set()
    print(clips.NOTICE)
    for path in paths:
        files |= set(clips.localize_card(site=site, path=path))
    print(f'{len(files)} local clips, {sum(f.stat().st_size for f in files) / 1024:.0f} KB')


def report(*, plans: list[tuple[Pick, list[dict[str, Any]]]], cards: list[CardRef], dry_run: bool) -> list[Path]:
    """Prints the picks per card and, unless dry_run, appends them; returns the card files written."""
    by_card: dict[str, list[tuple[Pick, list[dict[str, Any]]]]] = {}
    written = []
    for pick, exercises in plans:
        by_card.setdefault(pick.card.key, []).append((pick, exercises))
    for card in cards:
        done = by_card.get(card.key, [])
        print(f'{card.key}: {len(done)} clips, {sum(len(e) for _, e in done)} exercises')
        for pick, exercises in done:
            print(f'    «{pick.clip.text}» — {pick.clip.title}: {", ".join(e["id"] for e in exercises)}')
        if done and not dry_run:
            append_exercises(path=card.path, exercises=[e for _, exercises in done for e in exercises])
            written.append(card.path)
    return written


def comma_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(',') if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description='Add movie-clip exercises (playphrase.me references) to cards.')
    parser.add_argument('deck', type=Path, help='deck folder with deck.yaml')
    parser.add_argument('--cards', default='', help='card ids (or topic/id), comma-separated')
    parser.add_argument('--topics', default='', help='every card of these topics, comma-separated')
    parser.add_argument('--per-card', type=int, default=2, help='clips per card (default 2)')
    parser.add_argument('--max-searches', type=int, default=150, help='search requests this run may send (default 150)')
    parser.add_argument('--assume-top', type=int, default=1387, help='placement words known before the deck')
    parser.add_argument('--dry-run', action='store_true', help='search and pick, but do not write card.yaml')
    parser.add_argument('--localize', action='store_true',
                        help='store the new clips compressed in <card>/clips/ instead of linking playphrase.me')
    args = parser.parse_args()
    if not (args.deck / 'deck.yaml').exists():
        raise SystemExit(f'{args.deck}: no deck.yaml')
    targets = choose_cards(cards=load_cards(args.deck), ids=comma_list(args.cards), topics=comma_list(args.topics))
    run(deck_dir=args.deck, targets=targets, per_card=args.per_card, budget=args.max_searches,
        assume_top=args.assume_top, dry_run=args.dry_run, localize=args.localize)


if __name__ == '__main__':
    main()
