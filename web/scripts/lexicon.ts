// Rule B report for deck authors: npm run lexicon -- <deckdir> [--assume-top N] [--json]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDeck, isTextFile, type FileMap } from '../src/lib/deckfs';
import { lexiconReport } from '../src/lib/lexicon';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1] ?? ''; };
const json = args.includes('--json');
if (json) args.splice(args.indexOf('--json'), 1);
const top = flag('--assume-top');
const dir = args[0];
if (!dir) { console.error('usage: npm run lexicon -- <deckdir> [--assume-top N] [--json]'); process.exit(2); }

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
let base: string[];
let source: string;
if (top !== undefined) {
  if (!data.placement) { console.error('--assume-top needs placement.yaml in the deck'); process.exit(2); }
  base = data.placement.slice(0, Number(top)).map((w) => w.en);
  source = `placement top ${base.length}`;
} else if (data.known) {
  base = data.known.words;
  source = `known.yaml (${base.length} words)`;
} else {
  base = [];
  source = 'nothing (no known.yaml; pass --assume-top N to use placement.yaml)';
}
const report = lexiconReport(data, base);

if (json) {
  console.log(JSON.stringify({ deck: path.resolve(dir), assumed: source, ...report }, null, 2));
} else {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`Known before the deck: ${source}`);
  console.log(`${report.cards} cards, ${report.exercises} exercises; ${report.findings.length} exercises use words not met yet, ${report.distractors.length} have unknown words in wrong options\n`);
  let topic = '';
  for (const f of report.findings) {
    if (f.topic !== topic) console.log(`\n${(topic = f.topic)}`);
    console.log(`  ${f.card ? `${f.card} ` : ''}${f.exercise}: ${f.words.join(', ')}`);
  }
  if (report.distractors.length) {
    console.log(`\nUnknown words in wrong options (not misspellings of a known word): ${report.distractors.length}`);
    for (const f of report.distractors) console.log(`  ${f.topic}/${f.card ? `${f.card} ` : ''}${f.exercise}: ${f.words.join(', ')}`);
  }
  if (report.examples.length) {
    console.log(`\nCard examples with words not met yet: ${report.examples.length}`);
    for (const f of report.examples) console.log(`  ${f.topic}/${f.card} ${f.exercise}: ${f.words.join(', ')}`);
  }
  if (report.listening.length) {
    console.log('\nListening coverage');
    for (const c of report.listening) console.log(`  ${c.locked ? 'locked' : 'open  '} ${pct(c.coverage).padStart(4)} ${c.topic}/${c.card} (${c.counted} words) ${c.unknown.slice(0, 12).join(', ')}${c.unknown.length > 12 ? ' …' : ''}`);
  }
  if (report.outside.length) console.log(`\nWords in no card and not in placement (${report.outside.length}): ${report.outside.map((o) => `${o.word}×${o.count}`).join(', ')}`);
}
