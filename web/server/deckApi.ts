import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import YAML from 'yaml';

const run = promisify(execFile);

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
};

interface Options { deckDir: string; coreDir: string }

async function readYaml(file: string): Promise<any> {
  return YAML.parse(await fs.readFile(file, 'utf8'));
}

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
}

async function readIfExists(file: string): Promise<string | null> {
  return existsSync(file) ? fs.readFile(file, 'utf8') : null;
}

async function loadTemplate(dir: string, id: string, scope: string) {
  const manifestFile = path.join(dir, 'manifest.yaml');
  const view = await readIfExists(path.join(dir, 'view.njk'));
  if (!view) return null;
  return {
    id, scope,
    manifest: existsSync(manifestFile) ? await readYaml(manifestFile) : { id },
    view,
    style: (await readIfExists(path.join(dir, 'style.css'))) ?? '',
    logic: await readIfExists(path.join(dir, 'logic.js')),
  };
}

async function loadTemplatesIn(dir: string, scope: string) {
  const result = [];
  for (const id of await listDirs(dir)) {
    const tpl = await loadTemplate(path.join(dir, id), id, scope);
    if (tpl) result.push(tpl);
  }
  return result;
}

function splitFrontmatter(text: string): { meta: any; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  return { meta: YAML.parse(match[1]) ?? {}, body: match[2] };
}

async function loadMdExercises(cardDir: string) {
  const dir = path.join(cardDir, 'exercises');
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const result = [];
  for (const file of files) {
    const { meta, body } = splitFrontmatter(await fs.readFile(path.join(dir, file), 'utf8'));
    result.push({ id: meta.id ?? file.replace(/\.md$/, ''), template: 'md', skill: meta.skill, status: meta.status ?? 'draft', file: `exercises/${file}`, params: { markdown: body } });
  }
  return result;
}

async function loadCard(topicDir: string, topicId: string, cardId: string) {
  const cardDir = path.join(topicDir, cardId);
  const card = await readYaml(path.join(cardDir, 'card.yaml'));
  const theoryFile = card?.content?.theory;
  return {
    ...card,
    id: card.id ?? cardId,
    topic: topicId,
    path: `topics/${topicId}/${cardId}`,
    theory: theoryFile ? await readIfExists(path.join(cardDir, theoryFile)) : null,
    exercises: [...(card.exercises ?? []), ...(await loadMdExercises(cardDir))],
    templates: await loadTemplatesIn(path.join(cardDir, 'views'), `card:${topicId}/${cardId}`),
  };
}

async function loadTopic(deckDir: string, topicId: string) {
  const topicDir = path.join(deckDir, 'topics', topicId);
  const topic = await readYaml(path.join(topicDir, 'topic.yaml'));
  const cards = [];
  for (const cardId of await listDirs(topicDir)) {
    if (existsSync(path.join(topicDir, cardId, 'card.yaml'))) cards.push(await loadCard(topicDir, topicId, cardId));
  }
  const extra = path.join(topicDir, 'exercises.yaml');
  return {
    ...topic,
    id: topic.id ?? topicId,
    cards,
    exercises: existsSync(extra) ? (await readYaml(extra)) ?? [] : [],
    templates: await loadTemplatesIn(path.join(topicDir, 'views'), `topic:${topicId}`),
  };
}

async function loadDeck({ deckDir, coreDir }: Options) {
  const deck = await readYaml(path.join(deckDir, 'deck.yaml'));
  const order: string[] = deck.topics ?? [];
  const found = (await listDirs(path.join(deckDir, 'topics'))).filter((t) => existsSync(path.join(deckDir, 'topics', t, 'topic.yaml')));
  const ids = [...order.filter((t) => found.includes(t)), ...found.filter((t) => !order.includes(t))];
  const topics = [];
  for (const id of ids) topics.push(await loadTopic(deckDir, id));
  const core = await loadTemplatesIn(coreDir, 'core');
  const macros = await readIfExists(path.join(coreDir, '_macros.njk'));
  const baseCss = (await readIfExists(path.join(coreDir, '_base.css'))) ?? '';
  return {
    deck, topics, baseCss,
    templates: [...core, ...(await loadTemplatesIn(path.join(deckDir, 'templates'), 'deck'))],
    partials: { 'core/_macros': macros ?? '' },
  };
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`path outside deck: ${rel}`);
  return full;
}

function compactProgress(doc: YAML.Document, progress: any) {
  const node = doc.createNode(progress) as YAML.YAMLMap;
  for (const key of ['skills', 'exercises']) {
    const map = node.get(key) as YAML.YAMLMap | undefined;
    map?.items.forEach((item) => { (item.value as YAML.YAMLMap).flow = true; });
  }
  const totals = node.get('totals') as YAML.YAMLMap | undefined;
  if (totals) totals.flow = true;
  return node;
}

async function writeProgress(deckDir: string, cardPath: string, progress: any) {
  const file = safeJoin(deckDir, path.join(cardPath, 'card.yaml'));
  const doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
  doc.set('progress', compactProgress(doc, progress));
  await fs.writeFile(file, doc.toString({ lineWidth: 0 }));
}

async function appendJournal(deckDir: string, device: string, lines: string[]) {
  if (!lines.length) return;
  const month = new Date().toISOString().slice(0, 7);
  const dir = path.join(deckDir, 'journal', month);
  await fs.mkdir(dir, { recursive: true });
  const safeDevice = device.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'device';
  await fs.appendFile(path.join(dir, `${safeDevice}.tsv`), lines.join('\n') + '\n');
}

async function patchExercise(deckDir: string, body: any) {
  const cardDir = safeJoin(deckDir, body.cardPath);
  if (body.file) {
    const file = safeJoin(cardDir, body.file);
    const text = await fs.readFile(file, 'utf8');
    const { meta, body: md } = splitFrontmatter(text);
    Object.assign(meta, body.patch.status ? { status: body.patch.status } : {});
    const markdown = body.patch.params?.markdown ?? md;
    await fs.writeFile(file, `---\n${YAML.stringify(meta).trim()}\n---\n${markdown}`);
    return;
  }
  const file = path.join(cardDir, 'card.yaml');
  const doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
  const list = doc.get('exercises') as YAML.YAMLSeq<YAML.YAMLMap>;
  const item = list.items.find((ex) => ex.get('id') === body.exerciseId);
  if (!item) throw new Error(`exercise ${body.exerciseId} not found`);
  if (body.patch.status) item.set('status', body.patch.status);
  if (body.patch.params) item.set('params', doc.createNode(body.patch.params));
  await fs.writeFile(file, doc.toString({ lineWidth: 0 }));
}

async function activity(deckDir: string) {
  const days: Record<string, number> = {};
  const root = path.join(deckDir, 'journal');
  for (const month of await listDirs(root)) {
    for (const file of await fs.readdir(path.join(root, month))) {
      const text = await fs.readFile(path.join(root, month, file), 'utf8');
      for (const line of text.split('\n')) {
        const day = line.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days[day] = (days[day] ?? 0) + 1;
      }
    }
  }
  return days;
}

async function git(deckDir: string, args: string[]) {
  const { stdout, stderr } = await run('git', ['-C', deckDir, ...args]);
  return (stdout + stderr).trim();
}

async function sync(deckDir: string, device: string) {
  if (!existsSync(path.join(deckDir, '.git'))) return { ok: false, log: 'Колода не является git-репозиторием.' };
  const log: string[] = [];
  await git(deckDir, ['add', '-A']);
  const status = await git(deckDir, ['status', '--porcelain']);
  if (status) log.push(await git(deckDir, ['commit', '-m', `review: ${device} ${new Date().toISOString().slice(0, 16)}`]));
  const remotes = await git(deckDir, ['remote']);
  if (!remotes) return { ok: true, log: [...log, 'Удалённый репозиторий не настроен — изменения сохранены локальным коммитом.'].join('\n') };
  log.push(await git(deckDir, ['pull', '--rebase', '--autostash']));
  log.push(await git(deckDir, ['push']));
  return { ok: true, log: log.join('\n') };
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function serveFile(res: ServerResponse, root: string, rel: string) {
  const file = safeJoin(root, decodeURIComponent(rel));
  if (!existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(await fs.readFile(file));
}

function middleware(opts: Options) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (url.pathname.startsWith('/deck/')) return await serveFile(res, opts.deckDir, url.pathname.slice(6));
      if (!url.pathname.startsWith('/api/')) return next();
      if (url.pathname === '/api/deck') return send(res, 200, await loadDeck(opts));
      if (url.pathname === '/api/activity') return send(res, 200, await activity(opts.deckDir));
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (url.pathname === '/api/answer') {
        await serial(async () => {
          for (const update of body.updates ?? []) await writeProgress(opts.deckDir, update.cardPath, update.progress);
          await appendJournal(opts.deckDir, body.device ?? 'device', body.lines ?? []);
        });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/exercise') { await serial(() => patchExercise(opts.deckDir, body)); return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/sync') return send(res, 200, await serial(() => sync(opts.deckDir, body.device ?? 'device')));
      send(res, 404, { error: 'unknown endpoint' });
    } catch (error) {
      send(res, 500, { error: String((error as Error).message ?? error) });
    }
  };
}

export function deckApi(opts: Options): Plugin {
  return {
    name: 'zoobrik-deck-api',
    configureServer(server) { server.middlewares.use(middleware(opts)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(opts)); },
  };
}
