import { baseForms } from './gloss';
import type { Card, DeckData, Exercise, Topic } from './types';

// Rule B: an exercise may only use words the learner knew before the deck (known.yaml) or met in an introduced card.

type Has = (word: string) => boolean;
type Verdict = 'skip' | 'known' | 'unknown';

interface Index {
  /** Every word the deck knows of: placement lemmas with their forms and the words of every card term. */
  dict: Set<string>;
  forms: Map<string, string[]>;
}

const TOKEN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const LATIN = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;
const CONTRACTION = /^(.+?)(n't|'s|'re|'m|'ve|'ll|'d)$/;
const NEGATIVE: Record<string, string> = { wo: 'will', ca: 'can', sha: 'shall', ai: 'be' };
const FILE = /^[\w.-]+\.(mp3|m4a|wav|ogg|mp4|webm|jpe?g|png|webp|gif|svg)$/i;
// Shown after the answer, not shown at all, or written for the grader — none of it is text the learner has to read first.
const HIDDEN = new Set(['audio', 'accept', 'translation', 'explanation', 'hint', 'criteria', 'model_answer', 'note', 'placeholder', 'poster', 'media']);
const MIN_COVERAGE = 0.95;

const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");

/** Latin-script words of a text as written; numbers, Cyrillic, mixed tokens and suffix notation (-ing, 're) are dropped. */
export function tokens(text: string): string[] {
  const s = String(text ?? '');
  const out: string[] = [];
  for (const m of s.matchAll(TOKEN)) {
    const t = m[0].replace(/’/g, "'");
    const before = s[m.index - 1] ?? '';
    if (/['’-]/.test(before) && !/\p{L}/u.test(s[m.index - 2] ?? '')) continue;
    if (LATIN.test(t)) out.push(t);
  }
  return out;
}

/** What an exercise shows: `text` must be known; `distractors` (wrong options, extra chips, the sentence to fix) may be
 * deliberate non-words (shoutting), so only real words among them count. */
export interface ExerciseText { text: string[]; distractors: string[] }

/** The question side of a markdown exercise: gaps by their first answer, chips and options split into answer and distractors, no `???`. */
export function mdText(body: string): ExerciseText {
  const distractors: string[] = [];
  const text = String(body ?? '').split(/^\?\?\?\s*$/m)[0]
    .replace(/!audio\([^)]*\)/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[chips:([^\]]*)\]\]/g, (_, list: string) => { const [answer, extra = ''] = list.split('|'); distractors.push(extra.replace(/·/g, ' ')); return answer.replace(/·/g, ' '); })
    .replace(/\[\[order:([^\]]*)\]\]/g, (_, list: string) => list.replace(/·/g, ' '))
    .replace(/\[\[([^\]]*)\]\]/g, (_, gap: string) => gap.split('|')[0])
    .replace(/^\s*[-*] \[ \] (.*)$/gm, (_, option: string) => { distractors.push(option); return ''; })
    .replace(/^\s*[-*] \[[xX]\] /gm, '');
  return { text: [text], distractors };
}

function collect(value: unknown, out: string[]) {
  if (typeof value === 'string') { if (!FILE.test(value.trim())) out.push(value); }
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collect(v, out));
}

/** Strings of an exercise the learner reads or produces: params, the `from:` example, a markdown body before `???`. */
export function exerciseText(card: Card, exercise: Exercise): ExerciseText {
  const out: ExerciseText = { text: [], distractors: [] };
  const p = exercise.params ?? {};
  const right = new Set([p.answer, exercise.check?.expected].filter(Boolean).map(String));
  for (const [key, value] of Object.entries(p)) {
    if (HIDDEN.has(key)) continue;
    if (key === 'markdown') { const md = mdText(String(value)); out.text.push(...md.text); out.distractors.push(...md.distractors); }
    else if (key === 'options' && Array.isArray(value)) value.forEach((v) => collect(v, right.has(String(v)) ? out.text : out.distractors));
    else collect(value, key === 'extra' || key === 'wrong' ? out.distractors : out.text);
  }
  const from = exercise.from ?? '';
  if (from === 'content' && card.content.term) out.text.push(card.content.term);
  if (from.startsWith('examples.')) {
    const example = card.content.examples?.find((e) => e.id === from.slice('examples.'.length));
    if (example?.term) out.text.push(example.term);
  }
  return out;
}

const tokenCache = new WeakMap<Exercise, { text: string[]; distractors: string[] }>();
function exerciseTokens(card: Card, exercise: Exercise) {
  let cached = tokenCache.get(exercise);
  if (!cached) {
    const t = exerciseText(card, exercise);
    tokenCache.set(exercise, (cached = { text: t.text.flatMap(tokens), distractors: t.distractors.flatMap(tokens) }));
  }
  return cached;
}

export const transcriptTokens = (card: Card): string[] => (card.listening?.segments ?? []).flatMap((s) => tokens(s.text));

/** The term and its irregular forms, lowercased word by word: "of average height" → of, average, height. */
export const ownWords = (card: Card): string[] =>
  [card.content.term ?? '', ...(card.content.forms ?? [])].flatMap(tokens).map(norm);

const indexes = new WeakMap<DeckData, Index>();
function index(data: DeckData): Index {
  const cached = indexes.get(data);
  if (cached) return cached;
  const dict = new Set<string>();
  const forms = new Map<string, string[]>();
  for (const w of data.placement ?? []) {
    const lemma = norm(w.en);
    const irregular = (w.forms ?? []).map(norm);
    forms.set(lemma, [...(forms.get(lemma) ?? []), ...irregular]);
    [...tokens(w.en).map(norm), ...irregular].forEach((x) => dict.add(x));
  }
  for (const card of data.topics.flatMap((t) => t.cards)) ownWords(card).forEach((x) => dict.add(x));
  const idx = { dict, forms };
  indexes.set(data, idx);
  return idx;
}

/** Lemmas with their irregular forms from placement.yaml: go → go, went, gone. */
export function expand(data: DeckData, words: Iterable<string>): Set<string> {
  const { forms } = index(data);
  const out = new Set<string>();
  for (const w of words) {
    const lemma = norm(String(w));
    out.add(lemma);
    tokens(lemma).forEach((t) => out.add(norm(t)));
    forms.get(lemma)?.forEach((f) => out.add(f));
  }
  return out;
}

function knows(w: string, has: Has, dict: Set<string>): boolean {
  if (has(w)) return true;
  // A word of its own (thing, shed) must not pass as an inflection of another (the, she).
  if (dict.has(w)) return false;
  if (w.includes('-')) {
    const parts = w.split('-').filter((p) => p.length > 1);
    if (parts.length && parts.every((p) => knows(p, has, dict))) return true;
  }
  return baseForms(w).slice(1).some(has);
}

function verdict(raw: string, has: Has, idx: Index, allow?: Set<string>): Verdict {
  let w = norm(raw);
  // don't → do, won't → will, it's → it, Anna's → Anna; I'm leaves a single letter and is skipped.
  const c = CONTRACTION.exec(w);
  if (c && !has(w)) w = c[2] === "n't" ? NEGATIVE[c[1]] ?? c[1] : c[1];
  if (w.length < 2) return 'skip';
  if (allow && baseForms(w).some((b) => allow.has(b))) return 'skip';
  // Capitals the deck has no word for are names: Anna, Britain, the Fox of a fable.
  if (raw[0] !== raw[0].toLowerCase() && !baseForms(w).some((b) => idx.dict.has(b) || has(b))) return 'skip';
  return knows(w, has, idx.dict) ? 'known' : 'unknown';
}

/** Words of the list the learner would not know; each once, lowercased, in order of appearance. */
export function unknownWords(data: DeckData, words: string[], has: Has, allow?: Set<string>): string[] {
  const idx = index(data);
  const out = new Set<string>();
  for (const raw of words) if (verdict(raw, has, idx, allow) === 'unknown') out.add(norm(raw));
  return [...out];
}

/** Unknown words of an exercise: every unknown word of its text, real words only among its distractors. */
function exerciseUnknown(data: DeckData, t: { text: string[]; distractors: string[] }, has: Has, allow?: Set<string>): string[] {
  const extra = unknownWords(data, t.distractors, has, allow).filter((w) => !outsideDeck(data, w));
  return [...new Set([...unknownWords(data, t.text, has, allow), ...extra])];
}

// ---- Deliberate misspellings among distractors (goed, shoutting) vs real words the learner was never shown ----

// What a learner actually writes wrong: -eing for -ing, -ieing for -ying, a doubled or a dropped letter.
const SLIPS: [RegExp, string][] = [[/ieing$/, 'ying'], [/eing$/, 'ing'], [/ieed$/, 'ied']];
// A real word grows from a known one by these endings (sleepy, golden, kinda, skinny); a slip does not (heighth).
const REAL_TAIL = /^(?:y|en|a|al|ish|ic|ous|ive|ness|ity|ship|ful|less|ment|hood|ion|tion|ence|ance)$/;
const REAL_END = /(?:ness|ity|ship|ful|less|ment|hood|tion|sion|ence|ance)$/;

const collapse = (w: string) => w.replace(/([a-z])\1/g, '$1');

/** Forms a slip imitates, so studing is measured against studying, not study. */
function inflections(w: string): string[] {
  const stem = w.endsWith('e') ? w.slice(0, -1) : w;
  const y = /[^aeiou]y$/.test(w) ? w.slice(0, -1) : '';
  return [w, `${w}ing`, `${stem}ing`, `${stem}ed`, `${stem}er`, `${stem}est`, ...(y ? [`${y}ied`, `${y}ier`, `${y}iest`] : [])];
}

/** True when `short` is `long` with one letter taken out anywhere. */
function within(short: string, long: string): boolean {
  if (long.length - short.length !== 1) return false;
  let i = 0;
  for (const ch of long) if (ch === short[i]) i += 1;
  return i === short.length;
}

const spellIndex = new WeakMap<DeckData, Map<string, Set<string>>>();
function spellings(data: DeckData): Map<string, Set<string>> {
  let byLetter = spellIndex.get(data);
  if (!byLetter) {
    byLetter = new Map();
    for (const w of index(data).dict) for (const f of inflections(w)) {
      if (f.length < 5) continue;
      if (!byLetter.has(f[0])) byLetter.set(f[0], new Set());
      byLetter.get(f[0])!.add(f);
    }
    spellIndex.set(data, byLetter);
  }
  return byLetter;
}

/** True when a word of the deck shows through a token: a wrong inflection of a deck word (goed, childs, interestinger,
 * shoutting, writted, studieing, fixeing) or, at 5+ letters, a deck word form with one letter added or dropped (studing,
 * heighth). Real words that only look close stay unknown: a derivation (sleepy, kindness), a cut-off (usual), a changed
 * letter (theme/there, bold/bald), anything shorter. */
export function misspelling(data: DeckData, word: string, has: Has = () => false): boolean {
  const { dict } = index(data);
  const w = norm(word);
  const fixed = SLIPS.reduce((x, [re, to]) => x.replace(re, to), w);
  const seeds = [...new Set([w, fixed, collapse(w), collapse(fixed)])];
  const bases = seeds.flatMap((s) => baseForms(s)).flatMap((b) => [b, ...baseForms(b).slice(1)]);
  if (bases.some((b) => b !== w && (dict.has(b) || has(b)))) return true;
  if (w.length < 5 || REAL_END.test(w)) return false;
  for (const f of spellings(data).get(w[0]) ?? []) {
    if (f.length > w.length ? !within(w, f) || f.startsWith(w) : !within(f, w)) continue;
    if (w.startsWith(f)) {
      let tail = w.slice(f.length);
      if (tail[0] === f.at(-1)) tail = tail.slice(1);
      if (REAL_TAIL.test(tail)) continue;
    }
    return true;
  }
  return false;
}

/** Real words among the distractors the learner has not met and the deck never teaches; slips of known words pass. */
function distractorUnknown(data: DeckData, t: { distractors: string[] }, has: Has, allow?: Set<string>): string[] {
  return unknownWords(data, t.distractors, has, allow).filter((w) => outsideDeck(data, w) && !misspelling(data, w, has));
}

/** Known share of the counted words (running words, not distinct), and the unknown ones. */
export function coverage(data: DeckData, words: string[], has: Has): { coverage: number; counted: number; unknown: string[] } {
  const idx = index(data);
  let counted = 0;
  let known = 0;
  const unknown = new Set<string>();
  for (const raw of words) {
    const v = verdict(raw, has, idx);
    if (v === 'skip') continue;
    counted += 1;
    if (v === 'known') known += 1; else unknown.add(norm(raw));
  }
  return { coverage: counted ? known / counted : 1, counted, unknown: [...unknown] };
}

/** True when a word is in no card and not in placement.yaml at all (a typo, or a word the deck should teach). */
export function outsideDeck(data: DeckData, word: string): boolean {
  const { dict } = index(data);
  return !baseForms(norm(word)).some((b) => dict.has(b));
}

export const hasAny = (...sets: Set<string>[]): Has => (w) => sets.some((s) => s.has(w));

const matches = (card: Card, id: string) => card.id === id || `${card.topic}/${card.id}` === id;

// The learner's vocabulary changes only when a card is introduced, so one set per introduced-set is enough.
const learnerCache = new WeakMap<DeckData, { known: unknown; sets: Map<string, Set<string>> }>();
function learnerKnown(data: DeckData, introduced: Card[]): Set<string> {
  let entry = learnerCache.get(data);
  if (!entry || entry.known !== data.known) learnerCache.set(data, (entry = { known: data.known, sets: new Map() }));
  const key = introduced.map((c) => c.path).join('|');
  let set = entry.sets.get(key);
  if (!set) {
    set = expand(data, data.known?.words ?? []);
    for (const card of introduced) ownWords(card).forEach((w) => set!.add(w));
    if (entry.sets.size > 8) entry.sets.clear();
    entry.sets.set(key, set);
  }
  return set;
}

const introducedCards = (data: DeckData) => data.topics.flatMap((t) => t.cards).filter((c) => c.progress?.introduced);

/** A listening card's own exercises may use any word of its clip: the learner has just heard and read it. */
function ownSet(card: Card): Set<string> {
  return new Set([...ownWords(card), ...transcriptTokens(card).map(norm)]);
}

/** True when the exercise uses a word the learner neither knew before the deck nor has met in an introduced card. */
export function exerciseLocked(data: DeckData, card: Card, exercise: Exercise): boolean {
  if (!data.known) return false;
  const introduced = introducedCards(data);
  if (exercise.needs?.some((id) => !introduced.some((c) => matches(c, id)))) return true;
  const has = hasAny(learnerKnown(data, introduced), ownSet(card));
  const allow = exercise.allow?.length ? new Set(exercise.allow.flatMap(tokens).map(norm)) : undefined;
  return exerciseUnknown(data, exerciseTokens(card, exercise), has, allow).length > 0;
}

/** Share (0…1) of the clip's words the learner knows; 1 for non-listening cards. */
export function cardCoverage(data: DeckData, card: Card): number {
  if (!card.listening) return 1;
  const has = hasAny(learnerKnown(data, introducedCards(data)), new Set(ownWords(card)));
  return coverage(data, transcriptTokens(card), has).coverage;
}

export const minCoverage = (data: DeckData) => data.deck.listening?.min_coverage ?? MIN_COVERAGE;

/** True when a listening card's coverage is below deck.listening.min_coverage (default 0.95). */
export function cardLocked(data: DeckData, card: Card): boolean {
  if (!card.listening) return false;
  if (!data.known) return true;
  return cardCoverage(data, card) < minCoverage(data);
}

// ---- Author report: every exercise against the words before it in deck order ----

export interface WordFinding { topic: string; card: string; exercise: string; words: string[]; outside: string[] }
export interface ClipFinding { topic: string; card: string; coverage: number; counted: number; locked: boolean; unknown: string[] }
export interface LexiconReport {
  base: number;
  cards: number;
  exercises: number;
  findings: WordFinding[];
  /** Real words in wrong options / extra chips the learner has never met — not locking (they may be deliberate), but confusing. */
  distractors: WordFinding[];
  examples: WordFinding[];
  listening: ClipFinding[];
  outside: { word: string; count: number }[];
}

const ordered = (topic: Topic) => {
  const order = topic.order ?? [];
  return [...topic.cards].sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
};

/** Cards in teaching order: deck topics in deck.yaml order, cards by the topic's `order`. */
export const deckOrder = (data: DeckData): Card[] => data.topics.flatMap(ordered);

/** `base` is what the learner is assumed to know before the deck (known.yaml words, or the placement top N). */
export function lexiconReport(data: DeckData, base: Iterable<string>): LexiconReport {
  const known = expand(data, base);
  const seen = new Set<string>();
  const cards = deckOrder(data);
  const byId = new Map<string, Card>();
  cards.forEach((c) => { byId.set(c.id, c); byId.set(`${c.topic}/${c.id}`, c); });
  // A topic exercise opens once its last member card is in.
  const topicAfter = new Map<Card, Exercise[]>();
  for (const topic of data.topics) {
    for (const ex of topic.exercises) {
      const members = cards.filter((c) => c.topic === topic.id && ex.cards?.[c.id]);
      const last = members.at(-1);
      if (last) topicAfter.set(last, [...(topicAfter.get(last) ?? []), ex]);
    }
  }
  const outside = new Map<string, number>();
  const note = (words: string[]) => words.filter((w) => outsideDeck(data, w)).map((w) => { outside.set(w, (outside.get(w) ?? 0) + 1); return w; });
  const report: LexiconReport = { base: known.size, cards: cards.length, exercises: 0, findings: [], distractors: [], examples: [], listening: [], outside: [] };
  const check = (card: Card, id: string, words: { text: string[]; distractors: string[] }, own: Set<string>, ex?: Exercise, topicEx = false) => {
    const needs = new Set((ex?.needs ?? []).flatMap((n) => (byId.get(n) ? ownWords(byId.get(n)!) : [])));
    const allow = ex?.allow?.length ? new Set(ex.allow.flatMap(tokens).map(norm)) : undefined;
    const has = hasAny(known, seen, own, needs);
    const unknown = exerciseUnknown(data, words, has, allow);
    if (ex) {
      const wrong = distractorUnknown(data, words, has, allow).filter((w) => !unknown.includes(w));
      if (wrong.length) report.distractors.push({ topic: card.topic, card: topicEx ? '' : card.id, exercise: id, words: wrong, outside: wrong });
    }
    if (unknown.length) return { topic: card.topic, card: card.id, exercise: id, words: unknown, outside: note(unknown) };
    return null;
  };
  for (const card of cards) {
    ownWords(card).forEach((w) => seen.add(w));
    const own = card.listening ? ownSet(card) : new Set<string>();
    for (const ex of card.exercises) {
      if (ex.status === 'off') continue;
      report.exercises += 1;
      const f = check(card, ex.id, exerciseTokens(card, ex), own, ex);
      if (f) report.findings.push(f);
    }
    for (const example of card.content.examples ?? []) {
      const f = check(card, `examples.${example.id}`, { text: tokens(example.term), distractors: [] }, own);
      if (f) report.examples.push(f);
    }
    for (const ex of topicAfter.get(card) ?? []) {
      if (ex.status === 'off') continue;
      report.exercises += 1;
      const f = check(card, `topic:${ex.id}`, exerciseTokens(card, ex), own, ex, true);
      if (f) report.findings.push({ ...f, card: '' });
    }
    if (card.listening) {
      const c = coverage(data, transcriptTokens(card), hasAny(known, seen));
      note(c.unknown);
      report.listening.push({ topic: card.topic, card: card.id, coverage: c.coverage, counted: c.counted, locked: c.coverage < minCoverage(data), unknown: c.unknown });
    }
  }
  report.outside = [...outside].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  return report;
}
