"""Validate a Zoobrik deck against docs/deck-format.md."""

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

TEMPLATE_PARAMS: dict[str, set[str]] = {
    'intro': set(),
    'en-ru-choice': {'word', 'answer', 'options'},
    'en-ru-flip': {'front', 'back'},
    'ru-en-type': {'prompt', 'answer'},
    'ru-en-choice': {'prompt', 'answer', 'options'},
    'sentence-build-ru-en': {'prompt', 'answer', 'extra'},
    'sentence-build-en-ru': {'prompt', 'answer', 'extra'},
    'listen-type': {'audio', 'answer', 'translation'},
    'listen-choose-ru': {'audio', 'answer', 'options'},
    'cloze-type': {'text', 'answer'},
    'cloze-choice': {'text', 'answer', 'options'},
    'grammar-fix': {'wrong', 'answer'},
    'word-order': {'instruction', 'tokens', 'answer'},
    'match-pairs': {'pairs'},
}
SKILLS = {'recognize', 'recall', 'listen', 'spell', 'context', 'apply'}
STATUSES = {'draft', 'ready', 'off'}
ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]*$')


@dataclass
class Report:
    """Validation result."""

    errors: list[str] = field(default_factory=list)
    """Problems that break the app."""
    cards: int = 0
    """Number of cards checked."""
    exercises: int = 0
    """Number of exercises checked."""


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding='utf-8'))


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


def check_audio(*, where: str, params: dict[str, Any], audio_files: set[str], report: Report) -> None:
    audio = params.get('audio')
    if audio and audio not in audio_files:
        report.errors.append(f'{where}: audio {audio} is not a content audio file')


def check_skills(*, where: str, exercise: dict[str, Any], report: Report) -> None:
    skill = exercise.get('skill')
    if exercise.get('template') == 'intro' or skill is None and exercise.get('cards'):
        return
    skills = skill if isinstance(skill, list) else [skill]
    unknown = [name for name in skills if name not in SKILLS]
    if unknown:
        report.errors.append(f'{where}: unknown skills {unknown}')


def check_exercise(*, where: str, exercise: dict[str, Any], audio_files: set[str], report: Report) -> None:
    report.exercises += 1
    template = exercise.get('template', '')
    params = exercise.get('params') or {}
    if exercise.get('status') not in STATUSES:
        report.errors.append(f'{where}: bad status {exercise.get("status")}')
    if template in TEMPLATE_PARAMS:
        missing = TEMPLATE_PARAMS[template] - params.keys()
        if missing:
            report.errors.append(f'{where}: missing params {sorted(missing)}')
    elif not template.startswith('./views/') and template != 'inline':
        report.errors.append(f'{where}: unknown template {template}')
    check_skills(where=where, exercise=exercise, report=report)
    check_options(where=where, params=params, report=report)
    check_extra(where=where, params=params, report=report)
    check_gap(where=where, template=template, params=params, report=report)
    check_audio(where=where, params=params, audio_files=audio_files, report=report)


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
        if not example.get('en') or not example.get('ru'):
            report.errors.append(f'{where}: example {example.get("id")} lacks en or ru')


def check_card(*, card_dir: Path, report: Report) -> str:
    card = load_yaml(card_dir / 'card.yaml')
    where = f'{card_dir.parent.name}/{card_dir.name}'
    report.cards += 1
    if card.get('id') != card_dir.name:
        report.errors.append(f'{where}: id does not match folder')
    content = card.get('content') or {}
    if card.get('kind') == 'grammar' and content.get('theory') and not (card_dir / content['theory']).exists():
        report.errors.append(f'{where}: theory file missing')
    check_examples(where=where, content=content, report=report)
    audio_files = content_audio_files(content)
    ids = [exercise.get('id') for exercise in card.get('exercises') or []]
    if len(ids) != len(set(ids)):
        report.errors.append(f'{where}: duplicate exercise ids')
    for exercise in card.get('exercises') or []:
        check_exercise(where=f'{where}#{exercise.get("id")}', exercise=exercise, audio_files=audio_files, report=report)
    return card['id']


def check_topic(*, topic_dir: Path, all_cards: set[str], report: Report) -> None:
    topic = load_yaml(topic_dir / 'topic.yaml')
    card_ids = {path.parent.name for path in topic_dir.glob('*/card.yaml')}
    for card_id in sorted(card_ids):
        if card_id in all_cards:
            report.errors.append(f'{topic_dir.name}/{card_id}: card id is not unique in the deck')
        all_cards.add(check_card(card_dir=topic_dir / card_id, report=report))
    if set(topic.get('order') or []) != card_ids:
        report.errors.append(f'{topic_dir.name}: order does not list exactly the topic cards')
    if not ID_PATTERN.match(str(topic.get('id'))) or topic.get('id') != topic_dir.name:
        report.errors.append(f'{topic_dir.name}: topic id must match folder')
    extra_file = topic_dir / 'exercises.yaml'
    for exercise in (load_yaml(extra_file) or []) if extra_file.exists() else []:
        check_exercise(where=f'{topic_dir.name}#{exercise.get("id")}', exercise=exercise, audio_files=set(), report=report)
        missing = set(exercise.get('cards') or {}) - card_ids
        if missing:
            report.errors.append(f'{topic_dir.name}#{exercise.get("id")}: unknown cards {sorted(missing)}')


def validate(*, deck_dir: Path, only: list[str]) -> Report:
    report = Report()
    all_cards: set[str] = set()
    for topic_dir in sorted((deck_dir / 'topics').iterdir()):
        if not (topic_dir / 'topic.yaml').exists():
            continue
        if only and topic_dir.name not in only:
            continue
        try:
            check_topic(topic_dir=topic_dir, all_cards=all_cards, report=report)
        except yaml.YAMLError as error:
            report.errors.append(f'{topic_dir.name}: YAML error {error}')
    return report


def main() -> None:
    deck_dir = Path(sys.argv[1])
    report = validate(deck_dir=deck_dir, only=sys.argv[2:])
    for error in report.errors:
        print(error)
    print(f'{report.cards} cards, {report.exercises} exercises, {len(report.errors)} errors')
    sys.exit(1 if report.errors else 0)


if __name__ == '__main__':
    main()
