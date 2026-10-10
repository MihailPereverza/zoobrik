import { app, backend, refreshPending, scheduleSync, touch } from './state.svelte';
import { knownYaml, lemmaOf, withKnown } from './placement';
import { log } from './log';
import type { KnownWords } from './types';

/** Saves known.yaml the way answers are saved: pending commit on GitHub, deck files on the Mac, IndexedDB on the device. */
export async function saveKnown(known: KnownWords) {
  await backend().saveKnown(knownYaml(known));
  if (app.data) app.data.known = known;
  touch();
  await refreshPending();
  scheduleSync();
}

const lemmas = (words: string[]) => [...new Set(words.map((w) => lemmaOf(app.data?.placement, w)).filter(Boolean))];

/** «знаю» in the tap-to-translate popover only makes sense once the placement test has written known.yaml. */
export function canMarkKnown(words: string[]): boolean {
  const known = app.data?.known;
  return Boolean(known && lemmas(words).some((w) => !known.words.includes(w)));
}

export async function markKnown(words: string[]) {
  const known = app.data?.known;
  if (!known) return;
  const add = lemmas(words);
  log('known', 'marked known', add);
  await saveKnown(withKnown(known, add));
}
