import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import YAML from 'yaml';
import { readProgress, withProgress } from './cardyaml';
import { CORE } from './core';
import { buildDeck, deckRoots } from './deckfs';
import { deckLangs, normalizeContent } from './lang';
import { isPackagePath, packDeck, parseLink, planUpdate, previewDeck, slug, unpackDeck, withSource, type PackageFile } from './package';
import { audioVariants, pickVoice, resolveTemplate } from './render';

const deckYaml = 'id: english-a2\nname: Английский A2\nlang: { target: en-GB, native: ru }\nlimits: { new_cards_per_day: 8, reviews_per_day: 250 }\nfsrs:\n  retention: { recall: 0.9 }\n  params: [0.2, 1.2]\ntopics: [travel]\n';
const card = 'id: luggage\nkind: word\ncontent:\n  en: luggage\n  ru: багаж\n  alt_ru: [вещи]\n  examples:\n    - { id: ex1, en: My luggage is heavy., ru: Мой багаж тяжёлый. }\nexercises:\n  - { id: e1, template: ru-en-type, status: ready, params: { prompt: багаж, answer: luggage } }\n';
const progress = { stage: 'review', totals: { answers: 3, correct: 3, lapses: 0 }, skills: { recall: { state: 'review', s: 5, d: 5, due: '2026-10-10T00:00:00Z', reps: 3, lapses: 0, step: 0 } }, exercises: {}, recent: [] };
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3]);

function deckFiles(): PackageFile[] {
  return [
    { path: 'deck.yaml', text: withSource(deckYaml, { url: 'github:me/deck' }) },
    { path: 'topics/travel/topic.yaml', text: 'id: travel\ntitle: Путешествия\n' },
    { path: 'topics/travel/luggage/card.yaml', text: withProgress(card, progress) },
    { path: 'topics/travel/luggage/word.mp3', bytes: mp3 },
    { path: 'topics/travel/luggage/exercises/gap.md', text: '---\nid: gap\nstatus: ready\n---\nMy [[luggage]] is heavy.\n' },
    { path: 'journal/2026-10/iphone.tsv', text: '2026-10-01T10:00:00Z\tluggage\te1\trecall\t3\n' },
  ];
}

describe('package paths', () => {
  it('keeps deck content and drops journals, hidden folders and path tricks', () => {
    expect(isPackagePath('topics/a/b/card.yaml')).toBe(true);
    expect(isPackagePath('topics/a/b/word.mp3')).toBe(true);
    expect(isPackagePath('journal/2026-10/mac.tsv')).toBe(false);
    expect(isPackagePath('.git/config')).toBe(false);
    expect(isPackagePath('../secret.yaml')).toBe(false);
    expect(isPackagePath('/etc/passwd.txt')).toBe(false);
    expect(isPackagePath('topics/a/run.exe')).toBe(false);
  });
});

describe('.zoobrik round trip', () => {
  const unpacked = unpackDeck(packDeck(deckFiles(), new Date('2026-10-05T00:00:00Z')));
  const byPath = new Map(unpacked.map((f) => [f.path, f]));

  it('shares content without the learner’s progress, journal, FSRS weights or import source', () => {
    expect(readProgress(byPath.get('topics/travel/luggage/card.yaml')!.text!)).toBeNull();
    expect(byPath.get('topics/travel/luggage/card.yaml')!.text).toContain('luggage');
    expect([...byPath.keys()].some((p) => p.startsWith('journal/'))).toBe(false);
    const deck = YAML.parse(byPath.get('deck.yaml')!.text!);
    expect(deck.fsrs.params).toBeUndefined();
    expect(deck.fsrs.retention.recall).toBe(0.9);
    expect(deck.source).toBeUndefined();
  });

  it('keeps media byte for byte and markdown exercises as text', () => {
    expect([...byPath.get('topics/travel/luggage/word.mp3')!.bytes!]).toEqual([...mp3]);
    expect(byPath.get('topics/travel/luggage/exercises/gap.md')!.text).toContain('[[luggage]]');
  });

  it('writes a manifest that the importer does not treat as a deck file', () => {
    const raw = unzipSync(packDeck(deckFiles()));
    expect(JSON.parse(new TextDecoder().decode(raw['zoobrik.json']))).toMatchObject({ format: 1, id: 'english-a2', cards: 1 });
    expect(byPath.has('zoobrik.json')).toBe(false);
  });

  it('accepts a zip with the deck inside a folder, like GitHub "Download ZIP"', () => {
    const zip = zipSync({ 'deck-main/deck.yaml': strToU8(deckYaml), 'deck-main/topics/travel/topic.yaml': strToU8('id: travel\n'), 'deck-main/README.md': strToU8('# hi') });
    expect(unpackDeck(zip).map((f) => f.path).sort()).toEqual(['README.md', 'deck.yaml', 'topics/travel/topic.yaml']);
  });

  it('rejects an archive without deck.yaml', () => {
    expect(() => unpackDeck(zipSync({ 'notes.txt': strToU8('x') }))).toThrow(/deck\.yaml/);
  });

  it('previews what is inside before importing', () => {
    expect(previewDeck(unpacked)).toMatchObject({ id: 'english-a2', name: 'Английский A2', lang: 'EN → RU', topics: 1, cards: 1, exercises: 2, media: 1, scripts: 0 });
  });
});

describe('links', () => {
  it('understands short names, github.com URLs and direct files', () => {
    expect(parseLink('me/deck')).toEqual({ kind: 'github', owner: 'me', repo: 'deck', path: '', branch: undefined });
    expect(parseLink('github:me/lib/decks/spanish@dev')).toEqual({ kind: 'github', owner: 'me', repo: 'lib', path: 'decks/spanish', branch: 'dev' });
    expect(parseLink('https://github.com/me/lib/tree/main/decks/spanish')).toEqual({ kind: 'github', owner: 'me', repo: 'lib', path: 'decks/spanish', branch: 'main' });
    expect(parseLink('https://github.com/me/deck.git')).toMatchObject({ kind: 'github', owner: 'me', repo: 'deck', path: '' });
    expect(parseLink('https://example.com/a2.zoobrik')).toEqual({ kind: 'url', url: 'https://example.com/a2.zoobrik' });
    expect(parseLink('  ')).toBeNull();
  });

  it('makes folder-safe ids, transliterating Russian names', () => {
    expect(slug('Английский A2')).toBe('angliyskiy-a2');
    expect(slug('Phrasal verbs!')).toBe('phrasal-verbs');
    expect(slug('')).toBe('deck');
  });
});

describe('updating from the author', () => {
  const local = new Map(deckFiles().filter((f) => f.text !== undefined && !f.path.startsWith('journal/')).map((f) => [f.path, f.text!]));
  const media = new Set(['topics/travel/luggage/word.mp3']);
  const incoming: PackageFile[] = [
    { path: 'deck.yaml', text: deckYaml.replace('params: [0.2, 1.2]', 'params: null').replace('Английский A2', 'Английский A2+') },
    { path: 'topics/travel/topic.yaml', text: 'id: travel\ntitle: Путешествия\n' },
    { path: 'topics/travel/luggage/card.yaml', text: card.replace('багаж', 'багаж, вещи') },
    { path: 'topics/travel/luggage/word.mp3', bytes: mp3 },
    { path: 'topics/travel/passport/card.yaml', text: 'id: passport\nkind: word\ncontent: { en: passport, ru: паспорт }\n' },
    { path: 'topics/travel/passport/word.mp3', bytes: mp3 },
  ];
  const plan = planUpdate(local, media, incoming);
  const written = new Map(plan.write.map((f) => [f.path, f]));

  it('takes the new content but keeps the learner’s progress', () => {
    const merged = written.get('topics/travel/luggage/card.yaml')!.text!;
    expect(merged).toContain('багаж, вещи');
    expect(readProgress(merged)).toEqual(progress);
  });

  it('keeps personal FSRS weights and the import source in deck.yaml', () => {
    const deck = YAML.parse(written.get('deck.yaml')!.text!);
    expect(deck.name).toBe('Английский A2+');
    expect(deck.fsrs.params).toEqual([0.2, 1.2]);
    expect(deck.source.url).toBe('github:me/deck');
  });

  it('adds new cards and new media only, skips unchanged files', () => {
    expect(written.has('topics/travel/passport/card.yaml')).toBe(true);
    expect(written.has('topics/travel/passport/word.mp3')).toBe(true);
    expect(written.has('topics/travel/luggage/word.mp3')).toBe(false);
    expect(written.has('topics/travel/topic.yaml')).toBe(false);
    expect(plan).toMatchObject({ added: 2, changed: 2 });
  });

  it('removes files the author deleted, except cards that have progress', () => {
    expect(plan.remove).toEqual(['topics/travel/luggage/exercises/gap.md']);
    const withoutCard = planUpdate(local, media, incoming.filter((f) => !f.path.startsWith('topics/travel/luggage/')));
    expect(withoutCard.remove).not.toContain('topics/travel/luggage/card.yaml');
    expect(withoutCard.kept).toBe(1);
  });
});

describe('library layout and languages', () => {
  const lib = new Map<string, string>([
    ['deck.yaml', deckYaml],
    ['topics/travel/topic.yaml', 'id: travel\n'],
    ['topics/travel/luggage/card.yaml', card],
    ['decks/spanish/deck.yaml', 'name: Испанский\nlang: { target: es-ES, native: ru }\nlimits: { new_cards_per_day: 5, reviews_per_day: 100 }\nfsrs: { retention: {} }\n'],
    ['decks/spanish/topics/food/topic.yaml', 'id: food\n'],
    ['decks/spanish/topics/food/manzana/card.yaml', 'id: manzana\nkind: word\ncontent: { es: manzana, ru: яблоко, examples: [{ id: ex1, es: Como una manzana., ru: Я ем яблоко. }] }\n'],
  ]);

  it('finds the root deck and every decks/<id>/', () => {
    expect(deckRoots(lib.keys())).toEqual(['', 'decks/spanish/']);
  });

  it('builds the root deck without the nested ones', () => {
    const root = buildDeck(lib, CORE);
    expect(root.topics.map((t) => t.id)).toEqual(['travel']);
    expect(root.topics[0].cards[0].path).toBe('topics/travel/luggage');
  });

  it('builds a nested deck with full card paths and its own language', () => {
    const es = buildDeck(lib, CORE, 'decks/spanish/');
    const c = es.topics[0].cards[0];
    expect(c.path).toBe('decks/spanish/topics/food/manzana');
    expect(c.content).toMatchObject({ term: 'manzana', meaning: 'яблоко' });
    expect(c.content.examples![0]).toMatchObject({ term: 'Como una manzana.', meaning: 'Я ем яблоко.' });
    expect(deckLangs(es.deck).target).toMatchObject({ code: 'es', adverb: 'по-испански' });
  });

  it('reads language-code fields and generic fields alike', () => {
    const langs = deckLangs({ lang: { target: 'en-GB', native: 'ru' } });
    expect(normalizeContent({ en: 'gate', ru: 'выход', alt_ru: ['ворота'] } as any, langs)).toMatchObject({ term: 'gate', meaning: 'выход', alt: ['ворота'] });
    expect(normalizeContent({ term: 'gate', meaning: 'выход' }, langs)).toMatchObject({ term: 'gate', meaning: 'выход', alt: [] });
  });

  it('resolves old en/ru template ids to the language-neutral ones', () => {
    const data = buildDeck(lib, CORE);
    const c = data.topics[0].cards[0];
    expect(resolveTemplate(data, c, c.exercises[0])?.id).toBe('term-type');
    expect(resolveTemplate(data, c, { ...c.exercises[0], template: 'sentence-build-ru-en' })?.id).toBe('build-term');
  });
});

describe('several voices per recording', () => {
  const files = new Map<string, string>([['deck.yaml', deckYaml], ['topics/travel/topic.yaml', 'id: travel\n'], ['topics/travel/luggage/card.yaml', card]]);
  const media = ['word.mp3', 'word.turbo.mp3', 'word.piper.mp3', 'ex1.mp3', 'ex1.melo.mp3'].map((f) => `topics/travel/luggage/${f}`);
  const data = buildDeck(files, CORE, '', media);
  const c = data.topics[0].cards[0];

  it('lists the recording first, then the voices zoobrik-voice added next to it', () => {
    expect(audioVariants(data, c, 'word.mp3')).toEqual(['word.mp3', 'word.piper.mp3', 'word.turbo.mp3']);
    expect(audioVariants(data, c, 'ex1.mp3')).toEqual(['ex1.mp3', 'ex1.melo.mp3']);
    expect(audioVariants(data, c, 'ex2.mp3')).toEqual(['ex2.mp3']);
  });

  it('spreads exercises over all voices and keeps one voice within an exercise', () => {
    const picked = new Set(Array.from({ length: 30 }, (_, i) => pickVoice(data, c, 'word.mp3', i)));
    expect(picked).toEqual(new Set(['word.mp3', 'word.piper.mp3', 'word.turbo.mp3']));
    expect(pickVoice(data, c, 'word.mp3', 7)).toBe(pickVoice(data, c, 'word.mp3', 7));
    expect(pickVoice(data, c, 'ex2.mp3', 7)).toBe('ex2.mp3');
  });

  it('works for decks without extra voices', () => {
    const plain = buildDeck(files, CORE);
    expect(audioVariants(plain, plain.topics[0].cards[0], 'word.mp3')).toEqual(['word.mp3']);
  });
});
