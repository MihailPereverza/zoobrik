import type { CardContent, DeckConfig, Example } from './types';

export interface LangInfo { tag: string; code: string; name: string; adverb: string; short: string }

// Russian names, because the interface is Russian; unknown codes fall back to the code itself.
const NAMES: Record<string, [string, string]> = {
  en: ['английский', 'по-английски'], ru: ['русский', 'по-русски'], es: ['испанский', 'по-испански'],
  de: ['немецкий', 'по-немецки'], fr: ['французский', 'по-французски'], it: ['итальянский', 'по-итальянски'],
  pt: ['португальский', 'по-португальски'], ja: ['японский', 'по-японски'], zh: ['китайский', 'по-китайски'],
  ko: ['корейский', 'по-корейски'], tr: ['турецкий', 'по-турецки'], uk: ['украинский', 'по-украински'],
  pl: ['польский', 'по-польски'], el: ['греческий', 'по-гречески'], hi: ['хинди', 'на хинди'],
  ka: ['грузинский', 'по-грузински'], he: ['иврит', 'на иврите'], ar: ['арабский', 'по-арабски'],
};

export function langInfo(tag: string | undefined, fallback: string): LangInfo {
  const full = tag || fallback;
  const code = full.split(/[-_]/)[0].toLowerCase();
  const [name, adverb] = NAMES[code] ?? [code, code];
  return { tag: full, code, name, adverb, short: code.toUpperCase() };
}

export interface DeckLangs { target: LangInfo; native: LangInfo }

export function deckLangs(deck: Pick<DeckConfig, 'lang'> | null | undefined): DeckLangs {
  return { target: langInfo(deck?.lang?.target, 'en-GB'), native: langInfo(deck?.lang?.native, 'ru') };
}

const pick = (obj: Record<string, any>, ...keys: string[]) => keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null && v !== '');

function normalizeExample(ex: Example & Record<string, any>, langs: DeckLangs): Example {
  return { ...ex, term: pick(ex, 'term', langs.target.code) ?? '', meaning: pick(ex, 'meaning', langs.native.code) ?? '' };
}

/** Cards may name fields by language code (`en`, `ru`, `alt_ru`) or generically (`term`, `meaning`, `alt`); the app reads the generic ones. */
export function normalizeContent(content: CardContent & Record<string, any>, langs: DeckLangs): CardContent {
  const t = langs.target.code;
  const n = langs.native.code;
  return {
    ...content,
    term: pick(content, 'term', t),
    meaning: pick(content, 'meaning', n),
    alt: pick(content, 'alt', `alt_${n}`) ?? [],
    examples: (content.examples ?? []).map((ex: any) => normalizeExample(ex, langs)),
  };
}

export const cardLabel = (content: CardContent) => content.term ?? content.title ?? '';
