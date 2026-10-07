import { marked } from 'marked';

export interface MdExercise {
  kind: 'choice' | 'gaps' | 'chips' | 'flip';
  front: string;
  back: string;
  options: string[];
  answer: string;
  gaps: string[][];
  chips: { answer: string; extra: string[] };
}

const OPTION = /^\s*[-*] \[( |x|X)\] (.+)$/;
const CHIPS = /\[\[chips:\s*([^\]]+?)\]\]/;
const GAP = /\[\[([^\]]+?)\]\]/g;
const AUDIO = /!audio\(([^)]+)\)/g;

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

export function parseMdExercise(body: string, media: (file: string) => string): MdExercise {
  const [frontRaw, ...backParts] = body.split(/^\?\?\?\s*$/m);
  const audios: string[] = [];
  const keepAudio = (text: string) => text.replace(AUDIO, (_, f) => `ZBAUDIO${audios.push(f.trim()) - 1}ZB`);
  const { rest, options, answer } = extractOptions(keepAudio(frontRaw).split('\n'));
  let front = rest.join('\n');
  const chipsMatch = CHIPS.exec(front);
  let chips = { answer: '', extra: [] as string[] };
  if (chipsMatch) {
    const [answerPart, extraPart = ''] = chipsMatch[1].split('|');
    chips = { answer: splitWords(answerPart).join(' '), extra: splitWords(extraPart) };
    front = front.replace(CHIPS, '');
  }
  const gaps: string[][] = [];
  front = front.replace(GAP, (_, inner: string) => `ZBGAP${gaps.push(inner.split('|').map((v) => v.trim())) - 1}ZB`);
  let frontHtml = renderMarkdown(front).replace(/ZBGAP(\d+)ZB/g, (_, i) =>
    `<input class="zb-gap" data-zb-input data-gap="${i}" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:${Math.max(4, gaps[Number(i)][0].length + 2)}ch">`);
  frontHtml = withMedia(frontHtml, audios, media);
  const back = withMedia(renderMarkdown(keepAudio(backParts.join('\n'))), audios, media);
  const kind = options.length ? 'choice' : chips.answer ? 'chips' : gaps.length ? 'gaps' : 'flip';
  return { kind, front: frontHtml, back: back.trim(), options, answer, gaps, chips };
}
