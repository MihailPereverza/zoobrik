import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import YAML from 'yaml';
import { patchCardExercise, patchMdExercise, withProgress } from '../src/lib/cardyaml.ts';

const run = promisify(execFile);

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
};

interface Options { deckDir: string }

const TEXT = /\.(ya?ml|md|njk|css|js|json|txt|tsv)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);

async function listDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
}

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, child)));
    else out.push(child);
  }
  return out;
}

/** The whole library: text files with content, media by path. The app builds decks from it the same way as from GitHub. */
async function listFiles(deckDir: string) {
  const texts: Record<string, string> = {};
  const binaries: string[] = [];
  for (const rel of await walk(deckDir)) {
    if (TEXT.test(rel)) texts[rel] = await fs.readFile(path.join(deckDir, rel), 'utf8');
    else binaries.push(rel);
  }
  return { texts, binaries };
}

function deckRoot(root: unknown): string {
  const value = String(root ?? '');
  if (value !== '' && !/^decks\/[a-z0-9._-]+\/$/i.test(value)) throw new Error(`bad deck root: ${value}`);
  return value;
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

async function writeProgress(deckDir: string, cardPath: string, progress: any) {
  const file = safeJoin(deckDir, path.join(cardPath, 'card.yaml'));
  await fs.writeFile(file, withProgress(await fs.readFile(file, 'utf8'), progress));
}

async function appendJournal(deckDir: string, root: string, device: string, lines: string[]) {
  const safeDevice = device.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'device';
  const byMonth = new Map<string, string[]>();
  for (const line of lines) byMonth.set(line.slice(0, 7), [...(byMonth.get(line.slice(0, 7)) ?? []), line]);
  for (const [month, monthLines] of byMonth) {
    const dir = safeJoin(deckDir, `${root}journal/${month}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, `${safeDevice}.tsv`), monthLines.join('\n') + '\n');
  }
}

async function writeFiles(deckDir: string, root: string, body: any) {
  for (const rel of body.remove ?? []) {
    const file = safeJoin(deckDir, root + rel);
    if (existsSync(file)) await fs.rm(file);
  }
  for (const f of body.files ?? []) {
    const file = safeJoin(deckDir, root + f.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, f.text !== undefined ? f.text : Buffer.from(f.base64, 'base64'));
  }
}

async function patchExercise(deckDir: string, body: any) {
  const cardDir = safeJoin(deckDir, body.cardPath);
  const file = body.file ? safeJoin(cardDir, body.file) : path.join(cardDir, 'card.yaml');
  const text = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, body.file ? patchMdExercise(text, body.patch) : patchCardExercise(text, body.exerciseId, body.patch));
}

async function journalLines(deckDir: string, deck: string): Promise<string[]> {
  const root = path.join(deckDir, deck, 'journal');
  const lines: string[] = [];
  for (const month of await listDirs(root)) {
    for (const file of (await fs.readdir(path.join(root, month))).filter((f) => f.endsWith('.tsv'))) {
      lines.push(...(await fs.readFile(path.join(root, month, file), 'utf8')).split('\n').filter(Boolean));
    }
  }
  return lines.sort();
}

async function saveParams(deckDir: string, root: string, params: number[] | null) {
  const file = safeJoin(deckDir, `${root}deck.yaml`);
  const doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
  const node = doc.createNode(params);
  if (node instanceof YAML.YAMLSeq) node.flow = true;
  doc.setIn(['fsrs', 'params'], node);
  await fs.writeFile(file, doc.toString({ lineWidth: 0 }));
}

async function git(deckDir: string, args: string[]) {
  const { stdout, stderr } = await run('git', ['-C', deckDir, ...args]);
  return (stdout + stderr).trim();
}

async function sync(deckDir: string, device: string) {
  // e2e runs answer cards on the real deck; without this they commit and push test answers.
  if (process.env.ZB_NO_SYNC) return { ok: true, log: 'Синхронизация отключена (ZB_NO_SYNC).' };
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
      if (url.pathname === '/api/files') return send(res, 200, await listFiles(opts.deckDir));
      if (url.pathname === '/api/journal') return send(res, 200, await journalLines(opts.deckDir, deckRoot(url.searchParams.get('root'))));
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (url.pathname === '/api/answer') {
        await serial(async () => {
          for (const update of body.updates ?? []) await writeProgress(opts.deckDir, update.cardPath, update.progress);
          await appendJournal(opts.deckDir, deckRoot(body.root), body.device ?? 'device', body.lines ?? []);
        });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/deck-params') { await serial(() => saveParams(opts.deckDir, deckRoot(body.root), body.params ?? null)); return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/write') { await serial(() => writeFiles(opts.deckDir, deckRoot(body.root), body)); return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/remove-deck') {
        const root = deckRoot(body.root);
        if (!root) throw new Error('the root deck cannot be removed');
        await serial(() => fs.rm(safeJoin(opts.deckDir, root), { recursive: true, force: true }));
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
