import nunjucks from 'nunjucks/browser/nunjucks.js';
import { parseMdExercise, renderMarkdown, type MdExercise } from './md';
import { RUNTIME } from './runtime';
import { zubrikSvg, type Mood } from './mascot';
import { fontFaceCss } from './fonts';
import { deckLangs } from './lang';
import type { Card, DeckData, Exercise, Mode, TemplateSource, Topic } from './types';

export interface Rendered {
  srcdoc: string;
  html: string;
  css: string;
  template: TemplateSource;
  md?: MdExercise;
}

const escapeHtml = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function gapFilter(text: string, mode: string, answer?: string): string {
  const safe = escapeHtml(text);
  if (mode === 'input') return safe.replace('___', '<input class="zb-gap" data-zb-input autocomplete="off" autocapitalize="off" spellcheck="false">');
  // Two-part answers ("are … doing") fill the gaps one by one.
  const parts = String(answer ?? '').split(/\s*…\s*/);
  let i = 0;
  return safe.replace(/___/g, () => (mode === 'fill' ? `<span class="blank">${escapeHtml(parts[Math.min(i++, parts.length - 1)] ?? '')}</span>` : '<span class="blank">&nbsp;</span>'));
}

let env: any = null;
let envKey: DeckData | null = null;

function scopeName(t: TemplateSource): string {
  return `${t.scope}/${t.id}`;
}

function allTemplates(data: DeckData): TemplateSource[] {
  const topicTpls = data.topics.flatMap((t) => [...t.templates, ...t.cards.flatMap((c) => c.templates)]);
  return [...data.templates, ...topicTpls];
}

function environment(data: DeckData) {
  if (env && envKey === data) return env;
  const sources = new Map<string, string>(Object.entries(data.partials));
  for (const t of allTemplates(data)) sources.set(scopeName(t), t.view);
  const loader = { getSource: (name: string) => ({ src: sources.get(name) ?? '', path: name, noCache: false }) };
  env = new nunjucks.Environment(loader as any, { autoescape: true });
  env.addFilter('tokens', (s: string) => String(s ?? '').split(/\s+/).filter(Boolean));
  env.addFilter('concat', (a: unknown[], b: unknown[]) => [...(a ?? []), ...(b ?? [])]);
  env.addFilter('shuffle', (list: unknown[], seed: number) => {
    const rand = seeded(Number(seed) || 1);
    const copy = [...(list ?? [])];
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
    return copy;
  });
  env.addFilter('md', (s: string) => new nunjucks.runtime.SafeString(renderMarkdown(s)));
  env.addFilter('gap', (text: string, mode: string, answer?: string) => new nunjucks.runtime.SafeString(gapFilter(text, mode, answer)));
  env.addFilter('mask', (text: string, word: string) => String(text).replace(new RegExp(`\\b${word}\\b`, 'i'), '___'));
  env.addFilter('notIn', (list: string[], text: string) => (list ?? []).filter((x) => !String(text ?? '').toLowerCase().includes(String(x).toLowerCase())));
  env.addGlobal('zubrik', (mood: Mood, size = 40, crop: 'full' | 'head' = 'head') => new nunjucks.runtime.SafeString(zubrikSvg({ mood, size, crop })));
  env.addFilter('letters', (s: string) => String(s ?? '').split(''));
  envKey = data;
  return env;
}

export function topicOf(data: DeckData, card: Card): Topic {
  return data.topics.find((t) => t.id === card.topic)!;
}

/** Template ids from before decks became language-neutral; cards written with them keep working. */
export const LEGACY_TEMPLATES: Record<string, string> = {
  'en-ru-choice': 'meaning-choice', 'en-ru-flip': 'meaning-flip', 'ru-en-choice': 'term-choice', 'ru-en-type': 'term-type',
  'listen-choose-ru': 'listen-choice', 'sentence-build-en-ru': 'build-meaning', 'sentence-build-ru-en': 'build-term',
};

export function resolveTemplate(data: DeckData, card: Card, exercise: Exercise): TemplateSource | null {
  if (exercise.template === 'inline') {
    return { id: `inline-${exercise.id}`, scope: 'inline', manifest: { id: 'inline', check: exercise.check, trains: [] }, view: exercise.view ?? '', style: exercise.style ?? '', logic: null };
  }
  const local = exercise.template.startsWith('./views/');
  const id = local ? exercise.template.slice('./views/'.length) : exercise.template;
  const topic = topicOf(data, card);
  const chain = [card.templates, local ? [] : topic.templates, local ? [] : data.templates.filter((t) => t.scope === 'deck'), local ? [] : data.templates.filter((t) => t.scope === 'core')];
  for (const wanted of local || !LEGACY_TEMPLATES[id] ? [id] : [id, LEGACY_TEMPLATES[id]]) {
    for (const list of chain) {
      const found = list.find((t) => t.id === wanted);
      if (found) return found;
    }
  }
  return null;
}

const variantIndex = new WeakMap<object, Map<string, string[]>>();

/** zoobrik-voice writes word.mp3 plus word.<voice>.mp3 for every extra voice; this maps each recording to all its voices. */
function variantsOf(data: DeckData): Map<string, string[]> {
  const cached = variantIndex.get(data);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  const add = (key: string, path: string) => index.set(key, [...(index.get(key) ?? []), path]);
  for (const path of data.media ?? []) {
    const voice = /^(.*)\.[a-z0-9-]+(\.(?:mp3|ogg|opus|m4a|wav))$/i.exec(path);
    add(path, path);
    if (voice) add(`${voice[1]}${voice[2]}`, path);
  }
  for (const list of index.values()) list.sort();
  variantIndex.set(data, index);
  return index;
}

/** File names (relative to the card) of every voice of a recording; the recording itself comes first. */
export function audioVariants(data: DeckData, card: Card, file: string): string[] {
  if (!file || /^(https?:|data:|blob:)/.test(file)) return [file];
  const full = `${card.path}/${file}`;
  const found = (variantsOf(data).get(full) ?? []).filter((p) => p !== full).map((p) => p.slice(card.path.length + 1));
  return [file, ...found];
}

const voiceOf = (file: string) => /\.([a-z0-9-]+)\.[a-z0-9]+$/i.exec(file)?.[1] ?? '';

/** Voices present in the deck: '' is the main recording, the rest come from file names like word.turbo.mp3. */
function deckVoices(data: DeckData): string[] {
  const voices = new Set(['']);
  for (const list of variantsOf(data).values()) for (const path of list.slice(1)) voices.add(voiceOf(path));
  return [...voices].sort();
}

/**
 * One voice per exercise: the seed picks a voice for the whole exercise, so the word and its examples sound alike and
 * replays keep the voice; a recording missing in that voice falls back to another one.
 */
export function pickVoice(data: DeckData, card: Card, file: string, seed: number): string {
  const all = audioVariants(data, card, file);
  const voices = deckVoices(data);
  const wanted = voices[seed % voices.length];
  return all.find((f) => (f === file ? '' : voiceOf(f)) === wanted) ?? all[seed % all.length];
}

export function mediaUrl(card: Card, file: string): string {
  if (!file) return '';
  if (/^(https?:|data:|blob:)/.test(file)) return file;
  return `${location.origin}/deck/${card.path}/${file}`;
}

function coreStyle(data: DeckData, id: string): string {
  return data.templates.find((t) => t.scope === 'core' && t.id === id)?.style ?? '';
}

function frame(data: DeckData, template: TemplateSource, exercise: Exercise, body: string, attrs: Record<string, string>, theme: string): string {
  const inherited = template.scope === 'core' ? '' : coreStyle(data, template.id);
  const logic = template.logic ? template.logic.replace(/export\s+default\s+function/, 'window.__zbLogic = function').replace(/export\s+function/g, 'function') : '';
  const attrText = Object.entries(attrs).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">

<style>${fontFaceCss()}\n${data.baseCss}\n${inherited}\n${template.style}\n${exercise.style ?? ''}</style></head>
<body ${attrText}>${body}<script>${RUNTIME}</script>${logic ? `<script>${logic};window.__zbStart && window.__zbStart();</script>` : ''}</body></html>`;
}

export function render(data: DeckData, card: Card, exercise: Exercise, mode: Mode, theme: string, salt = ''): Rendered | { error: string } {
  const template = resolveTemplate(data, card, exercise);
  if (!template) return { error: `Шаблон «${exercise.template}» не найден` };
  const topic = topicOf(data, card);
  const seed = hashSeed(`${card.id}:${exercise.id}:${new Date().toISOString().slice(0, 10)}${salt}`);
  const voiceSeed = hashSeed(`${seed}:voice`);
  const media = (file: string) => mediaUrl(card, pickVoice(data, card, file, voiceSeed));
  const md = exercise.template === 'md' ? parseMdExercise(exercise.params?.markdown ?? '', media) : undefined;
  const context = {
    params: exercise.params ?? {}, card, exercise, topic: { id: topic.id, title: topic.title }, mode, seed, md,
    theory: card.theory, media, skills: card.progress?.skills ?? {}, lang: deckLangs(data.deck),
  };
  try {
    const e = environment(data);
    const html = template.scope === 'inline' ? e.renderString(template.view, context) : e.render(scopeName(template), context);
    const attrs: Record<string, string> = { template: template.id, card: card.id, topic: topic.id, mode };
    if (template.manifest.autoplay && mode !== 'intro') attrs.autoplay = '1';
    if (template.manifest.autoplay && mode === 'intro' && template.id === 'intro') attrs.autoplay = '1';
    const css = `${data.baseCss}\n${template.scope === 'core' ? '' : coreStyle(data, template.id)}\n${template.style}\n${exercise.style ?? ''}`;
    return { srcdoc: frame(data, template, exercise, html, attrs, theme), html, css, template, md };
  } catch (error) {
    return { error: `Ошибка в шаблоне «${template.id}»: ${(error as Error).message}` };
  }
}
