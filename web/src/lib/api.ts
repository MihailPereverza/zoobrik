import type { DeckData, Progress } from './types';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const loadDeck = () => request<DeckData>('/api/deck');
export const loadActivity = () => request<Record<string, number>>('/api/activity');
export const saveAnswer = (device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]) =>
  request('/api/answer', { device, updates, lines });
export const patchExercise = (body: { cardPath: string; exerciseId: string; file?: string; patch: { status?: string; params?: Record<string, unknown> } }) =>
  request('/api/exercise', body);
export const syncDeck = (device: string) => request<{ ok: boolean; log: string }>('/api/sync', { device });
