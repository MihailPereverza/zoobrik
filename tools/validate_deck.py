"""Validate a Zoobrik deck against docs/deck-format.md."""

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

TEMPLATE_PARAMS: dict[str, set[str]] = {
    'intro': set(),
    'meaning-choice': {'word', 'answer', 'options'},
    'meaning-flip': {'front', 'back'},
    'term-type': {'prompt', 'answer'},
    'term-choice': {'prompt', 'answer', 'options'},
    'build-term': {'prompt', 'answer', 'extra'},
    'build-meaning': {'prompt', 'answer', 'extra'},
    'listen-type': {'audio', 'answer', 'translation'},
    'listen-choice': {'audio', 'answer', 'options'},
    'cloze-type': {'text', 'answer'},
    'cloze-choice': {'text', 'answer', 'options'},
    'grammar-fix': {'wrong', 'answer'},
    'word-order': {'instruction', 'tokens', 'answer'},
    'match-pairs': {'pairs'},
    'open-answer': {'question', 'model_answer'},
    'clip-type': {'video', 'text', 'words', 'source', 'answer'},
    'clip-choice': {'video', 'text', 'words', 'source', 'question', 'answer', 'options'},
}
CLIP_TEMPLATES = {'clip-type', 'clip-choice'}
# A movie clip is a compressed copy in the card's clips/ (tools/clips.py localize) or a playphrase.me link to stream.
CLIP_VIDEO = re.compile(r'^(?:https://www\.playphrase\.me/video/[a-z]{3}/[0-9a-f]+/[0-9a-f]+\.mp4|clips/pp-[0-9a-f]+\.mp4)$')
# Ids from before decks became language-neutral; the app maps them to the new templates.
LEGACY_TEMPLATES: dict[str, str] = {
    'en-ru-choice': 'meaning-choice', 'en-ru-flip': 'meaning-flip', 'ru-en-choice': 'term-choice', 'ru-en-type': 'term-type',
    'listen-choose-ru': 'listen-choice', 'sentence-build-en-ru': 'build-meaning', 'sentence-build-ru-en': 'build-term',
}
SKILLS = {'recognize', 'recall', 'listen', 'spell', 'context', 'apply'}
STATUSES = {'draft', 'ready', 'off'}
ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]*$')
DEFAULT_LADDER = ['recognize', 'recall', 'context', 'listen', 'apply']
# Check types the app knows (web/src/lib/check.ts); any other type cannot grade an answer.
CHECK_TYPES = {'none', 'manual', 'ai', 'md', 'choice', 'tokens', 'fuzzy', 'exact', 'pairs', 'custom'}
# Shown to the learner without a grade: never asked by the schedule, so they need no skill.
UNGRADED_TEMPLATES = {'intro', 'back'}
CUSTOM_CHECK = re.compile(r'export\s+(?:function\s+check\b|(?:const|let|var)\s+check\s*=)')
CORE_DIR = Path(__file__).resolve().parent.parent / 'core-templates'


@dataclass
class Template:
    """A template folder: core-templates/<id>, <deck>/templates/<id>, or views/<id> of a topic or a card."""

    id: str
    """Folder name; exercises refer to it in `template:`."""
    scope: str
    """core, deck, topic or card."""
    manifest: dict[str, Any]
    """manifest.yaml, empty when the folder has none."""
    logic: str | None
    """logic.js source, if any."""


@dataclass
class Templates:
    """Templates an exercise can reach, from the most specific level to the most general."""

    core: dict[str, Template]
    deck: dict[str, Template]
    topic: dict[str, Template] = field(default_factory=dict)
    card: dict[str, Template] = field(default_factory=dict)

    def resolve(self, *, name: str) -> Template | None:
        """Same lookup as the app (render.ts resolveTemplate).

        ./views/<id> is the card's own template; a plain id goes card → topic → deck → core.
        """
        if name.startswith('./views/'):
            return self.card.get(name.removeprefix('./views/'))
        for wanted in [name, LEGACY_TEMPLATES[name]] if name in LEGACY_TEMPLATES else [name]:
            for level in (self.card, self.topic, self.deck, self.core):
                if wanted in level:
                    return level[wanted]
        return None


@dataclass
class Report:
    """Validation result."""

    errors: list[str] = field(default_factory=list)
    """Problems that break the app."""
    warnings: list[str] = field(default_factory=list)
    """Content the app accepts but never shows."""
    ladder: list[str] = field(default_factory=lambda: list(DEFAULT_LADDER))
    """deck.ladder: an exercise is asked only when one of its skills is on it."""
    cards: int = 0
    """Number of cards checked."""
    exercises: int = 0
    """Number of exercises checked."""


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding='utf-8'))


def load_templates(*, folder: Path, scope: str) -> dict[str, Template]:
    """Every <folder>/<id>/ with a view.njk, as the app reads them (deckfs.ts templatesUnder)."""
    if not folder.is_dir():
        return {}
    found: dict[str, Template] = {}
    for view in sorted(folder.glob('*/view.njk')):
        directory = view.parent
        manifest_file = directory / 'manifest.yaml'
        logic_file = directory / 'logic.js'
        found[directory.name] = Template(
            id=directory.name,
            scope=scope,
            manifest=(load_yaml(manifest_file) or {}) if manifest_file.exists() else {},
            logic=logic_file.read_text(encoding='utf-8') if logic_file.exists() else None,
        )
    return found


def required_params(*, template: Template) -> set[str]:
    """Params marked required in the manifest, plus the known minimum of a core template."""
    schema = template.manifest.get('params') or {}
    required = {name for name, spec in schema.items() if isinstance(spec, dict) and spec.get('required')}
    if template.scope == 'core':
        required |= TEMPLATE_PARAMS.get(template.id, set())
    return required


def tokens_of(text: str) -> set[str]:
    return {token.lower() for token in str(text).split()}


def check_options(*, where: str, params: dict[str, Any], report: Report) -> None:
    options = params.get('options')
    if options is None:
        return
    if params.get('answer') not in options:
        report.errors.append(f'{where}: answer is not among options')
    if len(set(options)) != len(options):
        report.errors.append(f'{where}: duplicate options')


def check_extra(*, where: str, params: dict[str, Any], report: Report) -> None:
    extra = params.get('extra')
    if extra is None:
        return
    answer_tokens = tokens_of(params.get('answer', ''))
    for variant in params.get('accept') or []:
        answer_tokens |= tokens_of(variant)
    clashes = [word for word in extra if str(word).lower() in answer_tokens]
    if clashes:
        report.errors.append(f'{where}: extra words are part of the answer: {clashes}')


def check_gap(*, where: str, template: str, params: dict[str, Any], report: Report) -> None:
    if template in {'cloze-type', 'cloze-choice'} and '___' not in str(params.get('text', '')):
        report.errors.append(f'{where}: text has no ___ gap')


def clip_problems(params: dict[str, Any]) -> list[str]:
    problems = []
    if not CLIP_VIDEO.match(str(params.get('video', ''))):
        problems.append('video must be clips/pp-<id>.mp4 or a playphrase.me video URL')
    words = params.get('words') or []
    timed = all(isinstance(w, list) and len(w) == 3 and all(isinstance(t, int) for t in w[1:]) for w in words)
    if not words or not timed:
        problems.append('words must be [[word, start ms, end ms], ...]')
    source = params.get('source') or {}
    if not (isinstance(source, dict) and source.get('title') and source.get('url')):
        problems.append('source needs title and url')
    if params.get('gap') and str(params['gap']) not in str(params.get('text', '')):
        problems.append('gap is not part of text')
    return problems


def check_clip(*, where: str, template: str, params: dict[str, Any], report: Report) -> None:
    if template in CLIP_TEMPLATES:
        report.errors.extend(f'{where}: {problem}' for problem in clip_problems(params))


def check_audio(*, where: str, params: dict[str, Any], audio_files: set[str], report: Report) -> None:
    audio = params.get('audio')
    if audio and audio not in audio_files:
        report.errors.append(f'{where}: audio {audio} is not a content audio file')


def check_skills(*, where: str, exercise: dict[str, Any], template: Template | None, report: Report) -> None:
    skill = exercise.get('skill')
    if exercise.get('template') in UNGRADED_TEMPLATES or skill is None and exercise.get('cards'):
        return
    if skill is None:
        skills = list((template.manifest.get('trains') or []) if template else [])
        if not skills and template:
            report.errors.append(f'{where}: no skill (set skill: or trains: in the template manifest)')
            return
    else:
        skills = skill if isinstance(skill, list) else [skill]
    unknown = [name for name in skills if name not in SKILLS]
    if unknown:
        report.errors.append(f'{where}: unknown skills {unknown}')
        return
    on_ladder = [name for name in skills if name in report.ladder or name == 'spell' and 'recall' in report.ladder]
    if skills and not on_ladder and exercise.get('status') == 'ready':
        report.warnings.append(f'{where}: skills {skills} are not on deck ladder {report.ladder}: never asked')


def check_check_type(*, where: str, exercise: dict[str, Any], template: Template | None, report: Report) -> None:
    if template is None and exercise.get('template') != 'inline':
        return
    kind = ((exercise.get('check') or {}).get('type')
            or ((template.manifest.get('check') or {}).get('type') if template else None)
            or 'none')
    if kind not in CHECK_TYPES:
        report.errors.append(f'{where}: unknown check type {kind}')
    elif kind == 'custom' and not (template and template.logic and CUSTOM_CHECK.search(template.logic)):
        report.errors.append(f'{where}: check custom without export function check in logic.js')


def check_exercise(*, where: str, exercise: dict[str, Any], audio_files: set[str], templates: Templates,
                   report: Report) -> None:
    report.exercises += 1
    name = exercise.get('template', '')
    params = exercise.get('params') or {}
    if exercise.get('status') not in STATUSES:
        report.errors.append(f'{where}: bad status {exercise.get("status")}')
    template = None if name == 'inline' else templates.resolve(name=name)
    if template is None and name != 'inline':
        report.errors.append(f'{where}: unknown template {name}')
    elif template is not None:
        missing = required_params(template=template) - params.keys()
        if missing:
            report.errors.append(f'{where}: missing params {sorted(missing)}')
    check_skills(where=where, exercise=exercise, template=template, report=report)
    check_check_type(where=where, exercise=exercise, template=template, report=report)
    check_options(where=where, params=params, report=report)
    check_extra(where=where, params=params, report=report)
    check_gap(where=where, template=template.id if template else name, params=params, report=report)
    check_audio(where=where, params=params, audio_files=audio_files, report=report)
    check_clip(where=where, template=template.id if template else name, params=params, report=report)


def content_audio_files(content: dict[str, Any]) -> set[str]:
    files = {example.get('audio') for example in content.get('examples') or []}
    if content.get('audio'):
        files.add(content['audio'])
    return {name for name in files if name}


def check_examples(*, where: str, content: dict[str, Any], report: Report) -> None:
    examples = content.get('examples') or []
    if len(examples) < 2:
        report.errors.append(f'{where}: fewer than 2 examples')
    for example in examples:
        if example.get('audio') != f'{example.get("id")}.mp3':
            report.errors.append(f'{where}: example {example.get("id")} audio must be <id>.mp3')
        texts = [key for key, value in example.items() if key not in {'id', 'audio'} and isinstance(value, str) and value]
        if len(texts) < 2:
            report.errors.append(f'{where}: example {example.get("id")} needs the sentence and its translation')


def check_listening(*, card_dir: Path, where: str, content: dict[str, Any], report: Report) -> None:
    for key in ('media', 'transcript'):
        if not content.get(key) or not (card_dir / content[key]).exists():
            report.errors.append(f'{where}: listening {key} file missing')
    if not (content.get('source') or {}).get('license'):
        report.errors.append(f'{where}: listening clip without a licence')


def check_card(*, card_dir: Path, templates: Templates, report: Report) -> str:
    card = load_yaml(card_dir / 'card.yaml')
    where = f'{card_dir.parent.name}/{card_dir.name}'
    report.cards += 1
    if card.get('id') != card_dir.name:
        report.errors.append(f'{where}: id does not match folder')
    content = card.get('content') or {}
    if card.get('kind') == 'grammar' and content.get('theory') and not (card_dir / content['theory']).exists():
        report.errors.append(f'{where}: theory file missing')
    if card.get('kind') == 'listening':
        check_listening(card_dir=card_dir, where=where, content=content, report=report)
        audio_files = {path.name for path in card_dir.glob('seg*.mp3')}
    else:
        check_examples(where=where, content=content, report=report)
        audio_files = content_audio_files(content)
    ids = [exercise.get('id') for exercise in card.get('exercises') or []]
    if len(ids) != len(set(ids)):
        report.errors.append(f'{where}: duplicate exercise ids')
    card_templates = Templates(core=templates.core, deck=templates.deck, topic=templates.topic,
                               card=load_templates(folder=card_dir / 'views', scope='card'))
    for exercise in card.get('exercises') or []:
        check_exercise(where=f'{where}#{exercise.get("id")}', exercise=exercise, audio_files=audio_files,
                       templates=card_templates, report=report)
    return card['id']


def check_topic(*, topic_dir: Path, all_cards: set[str], templates: Templates, report: Report) -> None:
    topic = load_yaml(topic_dir / 'topic.yaml')
    card_ids = {path.parent.name for path in topic_dir.glob('*/card.yaml')}
    topic_templates = Templates(core=templates.core, deck=templates.deck,
                                topic=load_templates(folder=topic_dir / 'views', scope='topic'))
    for card_id in sorted(card_ids):
        if card_id in all_cards:
            report.errors.append(f'{topic_dir.name}/{card_id}: card id is not unique in the deck')
        all_cards.add(check_card(card_dir=topic_dir / card_id, templates=topic_templates, report=report))
    if set(topic.get('order') or []) != card_ids:
        report.errors.append(f'{topic_dir.name}: order does not list exactly the topic cards')
    if not ID_PATTERN.match(str(topic.get('id'))) or topic.get('id') != topic_dir.name:
        report.errors.append(f'{topic_dir.name}: topic id must match folder')
    extra_file = topic_dir / 'exercises.yaml'
    for exercise in (load_yaml(extra_file) or []) if extra_file.exists() else []:
        check_exercise(where=f'{topic_dir.name}#{exercise.get("id")}', exercise=exercise, audio_files=set(),
                       templates=topic_templates, report=report)
        missing = set(exercise.get('cards') or {}) - card_ids
        if missing:
            report.errors.append(f'{topic_dir.name}#{exercise.get("id")}: unknown cards {sorted(missing)}')


def validate(*, deck_dir: Path, only: list[str]) -> Report:
    report = Report()
    deck_file = deck_dir / 'deck.yaml'
    deck = (load_yaml(deck_file) or {}) if deck_file.exists() else {}
    if deck.get('ladder'):
        report.ladder = list(deck['ladder'])
    templates = Templates(core=load_templates(folder=CORE_DIR, scope='core'),
                          deck=load_templates(folder=deck_dir / 'templates', scope='deck'))
    all_cards: set[str] = set()
    for topic_dir in sorted((deck_dir / 'topics').iterdir()):
        if not (topic_dir / 'topic.yaml').exists():
            continue
        if only and topic_dir.name not in only:
            continue
        try:
            check_topic(topic_dir=topic_dir, all_cards=all_cards, templates=templates, report=report)
        except yaml.YAMLError as error:
            report.errors.append(f'{topic_dir.name}: YAML error {error}')
    return report


def main() -> None:
    deck_dir = Path(sys.argv[1])
    report = validate(deck_dir=deck_dir, only=sys.argv[2:])
    for error in report.errors:
        print(error)
    for warning in report.warnings:
        print(f'warning: {warning}')
    print(f'{report.cards} cards, {report.exercises} exercises, '
          f'{len(report.errors)} errors, {len(report.warnings)} warnings')
    sys.exit(1 if report.errors else 0)


if __name__ == '__main__':
    main()
