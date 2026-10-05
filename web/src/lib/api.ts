import { encodeBase64 } from './github';
import type { PackageFile } from './package';
import type { Progress } from './types';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

/** Every text file of the library on this Mac, plus the paths of its media. */
export interface Listing { texts: Record<string, string>; binaries: string[] }

export const listFiles = () => request<Listing>('/api/files');
export const saveAnswer = (root: string, device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]) =>
  request('/api/answer', { root, device, updates, lines });
export const patchExercise = (body: { cardPath: string; exerciseId: string; file?: string; patch: { status?: string; params?: Record<string, unknown> } }) =>
  request('/api/exercise', body);
export const loadJournal = (root: string) => request<string[]>(`/api/journal?root=${encodeURIComponent(root)}`);
export const saveDeckParams = (root: string, params: number[] | null) => request('/api/deck-params', { root, params });
export const syncDeck = (device: string) => request<{ ok: boolean; log: string }>('/api/sync', { device });

export const writeFiles = (root: string, files: PackageFile[], remove: string[]) =>
  request('/api/write', { root, remove, files: files.map((f) => (f.text !== undefined ? { path: f.path, text: f.text } : { path: f.path, base64: encodeBase64(f.bytes!) })) });
export const removeDeck = (root: string) => request('/api/remove-deck', { root });
