import type { Card, Transcript } from './types';

const escapeHtml = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fixed = (n: number) => (Math.round(n * 100) / 100).toString();

/** "12.5-30", "1:05-1:20", "" (whole clip) → seconds; the end is open when missing. */
export function parseRange(spec: string): { start: number; end: number | null } {
  const toSec = (t: string) => t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  const [a, b] = String(spec ?? '').split('-').map((s) => s.trim());
  return { start: a ? toSec(a) : 0, end: b ? toSec(b) : null };
}

/** Lines of the transcript that overlap the range, each word carrying its time so the runtime can highlight and seek. */
export function transcriptHtml(transcript: Transcript | null, start: number, end: number | null): string {
  const lines = (transcript?.segments ?? []).filter((s) => s.end > start && (end === null || s.start < end));
  if (!lines.length) return '<p class="zb-tx-empty">Транскрипта для этого фрагмента нет.</p>';
  return lines.map((s) => {
    const words = s.words?.length
      ? s.words.map((w) => `<span data-w data-t="${fixed(w.start)}" data-e="${fixed(w.end)}">${escapeHtml(w.word.trim())}</span>`).join(' ')
      : escapeHtml(s.text);
    const who = s.speaker ? `<b class="zb-spk">${escapeHtml(s.speaker)}</b> ` : '';
    const seek = `<button type="button" class="zb-seek" data-seek="${fixed(s.start)}" aria-label="Слушать с этой фразы">▸</button>`;
    const ru = s.ru ? `<span class="zb-tx-ru">${escapeHtml(s.ru)}</span>` : '';
    return `<p class="zb-tx-line">${seek}<span class="zb-tx-text">${who}${words}${ru}</span></p>`;
  }).join('');
}

const ICON = { play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>' };

/**
 * A player for the card's audio or video limited to a range, with a transcript that stays hidden until asked for
 * (looking at it counts as a hint, like in a listening test).
 */
export function playerHtml(card: Card, mediaUrl: string, range: string): string {
  const { start, end } = parseRange(range);
  const video = /\.(mp4|webm|m4v|mov)$/i.test(card.content.media ?? '');
  const label = end === null ? (start ? `с ${fixed(start)} с` : 'весь фрагмент') : `${fixed(end - start)} с`;
  return `<div class="zb-player${video ? ' video' : ''}" data-zb-media="${escapeHtml(mediaUrl)}" data-kind="${video ? 'video' : 'audio'}" data-start="${fixed(start)}"${end === null ? '' : ` data-end="${fixed(end)}"`}>
  ${video ? '<div class="zb-screen"></div>' : ''}
  <div class="zb-pbar"><span></span></div>
  <div class="zb-pctl">
    <button type="button" class="zb-pbtn main" data-act="play" aria-label="Воспроизвести">${ICON.play}</button>
    <button type="button" class="zb-pbtn" data-act="back" aria-label="Назад на 3 секунды">−3</button>
    <button type="button" class="zb-pbtn rate" data-act="rate" aria-label="Скорость">1×</button>
    <span class="zb-plabel">${label}</span>
    <button type="button" class="zb-pbtn text" data-act="text" aria-expanded="false">Текст</button>
  </div>
  <div class="zb-tx" hidden>${transcriptHtml(card.transcript ?? null, start, end)}</div>
</div>`;
}
