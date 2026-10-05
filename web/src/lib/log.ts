export interface LogEntry { t: string; area: string; msg: string; data?: unknown }

const LIMIT = 500;
const KEY = 'zb.log';
const entries: LogEntry[] = restore();

function restore(): LogEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]').slice(-LIMIT); } catch { return []; }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-300))); } catch { /* storage full or blocked: keep in memory only */ } }, 500);
}
const listeners = new Set<() => void>();

function short(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 160) return `${value.slice(0, 160)}…`;
  return value;
}

export function log(area: string, msg: string, data?: unknown) {
  const entry: LogEntry = { t: new Date().toISOString().slice(11, 23), area, msg, data: short(data) };
  entries.push(entry);
  if (entries.length > LIMIT) entries.shift();
  console.log(`[zb:${area}] ${msg}`, data === undefined ? '' : data);
  persist();
  listeners.forEach((fn) => fn());
}

export function logEntries(): LogEntry[] { return entries; }

export function onLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLog() { entries.length = 0; persist(); listeners.forEach((fn) => fn()); }

export function logText(): string {
  return entries.map((e) => `${e.t} [${e.area}] ${e.msg}${e.data === undefined ? '' : ` ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`}`).join('\n');
}

// Media URLs are long; logs keep the meaningful tail (card/file).
export function mediaName(url: string): string {
  const at = url.indexOf('/deck/');
  return at >= 0 ? url.slice(at + 6).replace(/^topics\//, '') : url.slice(0, 40);
}
