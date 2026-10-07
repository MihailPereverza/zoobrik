import { marked } from 'marked';

export interface MdExercise {
  kind: 'choice' | 'gaps' | 'chips' | 'flip' | 'open';
  /** For open questions: the model answer as plain text, given to the AI grader or shown for self-grading. */
  reference: string;
  front: string;
  back: string;
  options: string[];
  answer: string;
  gaps: string[][];
  chips: { answer: string; extra: string[]; items?: string[]; phrases?: boolean };
}

const OPTION = /^\s*[-*] \[( |x|X)\] (.+)$/;
const CHIPS = /\[\[chips:\s*([^\]]+?)\]\]/;
const GAP = /\[\[([^\]]+?)\]\]/g;
const AUDIO = /!audio\(([^)]+)\)/g;
const CLIP = /!clip\(([^)]*)\)/g;

export function renderMarkdown(text: string): string {
  return marked.parse(String(text ?? ''), { async: false, breaks: false }) as string;
}

function playButton(src: string): string {
  return `<button class="zb-play" data-zb="play" data-src="${src}" type="button" aria-label="Прослушать"><svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z"/></svg></button>`;
}

function splitWords(list: string): string[] {
  return list.split('·').map((w) => w.trim()).filter(Boolean);
}

function extractOptions(lines: string[]): { rest: string[]; options: string[]; answer: string } {
  const rest: string[] = [];
  const options: string[] = [];
  let answer = '';
  for (const line of lines) {
    const m = OPTION.exec(line);
    if (!m) { rest.push(line); continue; }
    options.push(m[2].trim());
    if (m[1].toLowerCase() === 'x') answer = m[2].trim();
  }
  return { rest, options, answer };
}

function withMedia(html: string, audios: string[], media: (f: string) => string): string {
  return html.replace(/ZBAUDIO(\d+)ZB/g, (_, i) => playButton(media(audios[Number(i)])));
}

/** `!clip(12-30)` puts the card's audio or video player (that range) into an exercise; listening cards supply it. */
export type ClipRenderer = (range: string) => string;

export function parseMdExercise(body: string, media: (file: string) => string, clip?: ClipRenderer): MdExercise {
  const [frontRaw, ...backParts] = body.split(/^\?\?\?\s*$/m);
  const audios: string[] = [];
  const clips: string[] = [];
  const keepAudio = (text: string) => text
    .replace(AUDIO, (_, f) => `ZBAUDIO${audios.push(f.trim()) - 1}ZB`)
    .replace(CLIP, (_, r) => `\n\nZBCLIP${clips.push(r.trim()) - 1}ZB\n\n`);
  const withClips = (html: string) => html
    .replace(/<p>ZBCLIP(\d+)ZB<\/p>/g, (_, i) => (clip ? clip(clips[Number(i)]) : ''))
    .replace(/ZBCLIP(\d+)ZB/g, (_, i) => (clip ? clip(clips[Number(i)]) : ''));
  const { rest, options, answer } = extractOptions(keepAudio(frontRaw).split('\n'));
  let front = rest.join('\n');
  const chipsMatch = CHIPS.exec(front);
  let chips: MdExercise['chips'] = { answer: '', extra: [] };
  if (chipsMatch) {
    const [answerPart, extraPart = ''] = chipsMatch[1].split('|');
    const items = splitWords(answerPart);
    // Chips that are whole phrases ("She tries it on.") are moved as units, e.g. to put events in order.
    const phrases = items.some((item) => /\s/.test(item));
    chips = { answer: items.join(' '), extra: splitWords(extraPart), items, phrases };
    front = front.replace(CHIPS, '');
  }
  const open = /\[\[open\]\]/.test(front);
  front = front.replace(/\[\[open\]\]/, 'ZBOPENZB');
  const gaps: string[][] = [];
  front = front.replace(GAP, (_, inner: string) => `ZBGAP${gaps.push(inner.split('|').map((v) => v.trim())) - 1}ZB`);
  let frontHtml = renderMarkdown(front).replace(/ZBGAP(\d+)ZB/g, (_, i) =>
    `<input class="zb-gap" data-zb-input data-gap="${i}" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:${Math.max(4, gaps[Number(i)][0].length + 2)}ch">`);
  frontHtml = frontHtml.replace(/(<p>)?ZBOPENZB(<\/p>)?/, '<textarea class="zb-open" data-zb-input rows="3" autocapitalize="sentences" spellcheck="false" placeholder="Ответ по-английски" aria-label="Твой ответ"></textarea>');
  frontHtml = withClips(withMedia(frontHtml, audios, media));
  const back = withClips(withMedia(renderMarkdown(keepAudio(backParts.join('\n'))), audios, media));
  const kind = open ? 'open' : options.length ? 'choice' : chips.answer ? 'chips' : gaps.length ? 'gaps' : 'flip';
  const reference = backParts.join('\n').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  return { kind, front: frontHtml, back: back.trim(), options, answer, gaps, chips, reference };
}
