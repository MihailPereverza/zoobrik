// Prerequisites of movie-clip lines (tools/playphrase.py): npx tsx scripts/clips-filter.ts <deckdir> <in.json> [--assume-top N]
// in.json: [{ key, card: "topic/id", texts: [line, wrong option, …] }] → stdout: [{ key, step, unknown: [...], rules: [...] }]
// A line passes when every word is known at the card's teaching step (placement top N + terms of the cards introduced by
// then, the card itself included) and every rule it uses is taught by then.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { teachingSteps } from '../src/lib/curriculum';
import { buildDeck, isTextFile, type FileMap } from '../src/lib/deckfs';
import { rulesIn, sentences } from '../src/lib/grammar';
import { expand, hasAny, ownWords, tokens, unknownWords } from '../src/lib/lexicon';
import type { Card } from '../src/lib/types';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1] ?? ''; };
const top = Number(flag('--assume-top') ?? 1387);
const [dir, input] = args;
if (!dir || !input) { console.error('usage: tsx scripts/clips-filter.ts <deckdir> <in.json> [--assume-top N]'); process.exit(2); }

function read(root: string): FileMap {
  const files: FileMap = new Map();
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.') && p !== 'journal') walk(p); }
      else if (isTextFile(p)) files.set(p, readFileSync(path.join(root, p), 'utf8'));
    }
  };
  walk('');
  return files;
}

const data = buildDeck(read(path.resolve(dir)), { templates: [], partials: {}, baseCss: '' });
const base = expand(data, (data.placement ?? []).slice(0, top).map((w) => w.en));
const steps = teachingSteps(data);
const stepOf = new Map<Card, number>();
steps.forEach((cards, i) => cards.forEach((c) => stepOf.set(c, i + 1)));
const byId = new Map(data.topics.flatMap((t) => t.cards).map((c) => [`${c.topic}/${c.id}`, c]));

// Words of every card introduced up to and including a step.
const seenBy = (step: number) => new Set(steps.slice(0, step).flat().flatMap(ownWords));

const items: { key: string; card: string; texts: string[] }[] = JSON.parse(readFileSync(input, 'utf8'));
const out = items.map(({ key, card: id, texts }) => {
  const card = byId.get(id);
  if (!card) return { key, step: 0, unknown: [], rules: [], error: `no card ${id}` };
  const step = stepOf.get(card) ?? steps.length;
  const has = hasAny(base, seenBy(step), new Set(ownWords(card)));
  const unknown = unknownWords(data, texts.flatMap(tokens), has);
  const rules = rulesIn(data, texts.flatMap((t) => sentences(t)))
    .filter((r) => r !== card && (stepOf.get(r) ?? Infinity) > step)
    .map((r) => `${r.topic}/${r.id}`);
  return { key, step, unknown, rules };
});
console.log(JSON.stringify(out, null, 1));
