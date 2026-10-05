// Zubrik, the bison mascot: one SVG source shared by the app (Svelte) and the exercise templates (Nunjucks).
export type Mood = 'hello' | 'happy' | 'oops' | 'think' | 'sleep' | 'cheer';

export interface MascotOptions {
  mood?: Mood;
  size?: number;
  crop?: 'full' | 'head';
  still?: boolean;
  phase?: number;
  poke?: number;
}

const SPRING = 'cubic-bezier(.3,1.4,.5,1)';

export const MASCOT_KEYFRAMES = `
@keyframes zb-breathe{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-1.5px) scale(1.008,1.012)}}
@keyframes zb-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes zb-earL{0%,86%,95%,100%{transform:rotate(0deg)}89%{transform:rotate(12deg)}92%{transform:rotate(-4deg)}}
@keyframes zb-earR{0%,86%,95%,100%{transform:rotate(0deg)}89%{transform:rotate(-12deg)}92%{transform:rotate(4deg)}}
@keyframes zb-hop{0%,100%{transform:translateY(0) scale(1,1)}30%{transform:translateY(-9px) scale(.99,1.02)}60%{transform:translateY(0) scale(1.02,.97)}}
@keyframes zb-shake{0%,100%{transform:rotate(0deg)}20%{transform:rotate(-4deg)}40%{transform:rotate(3deg)}60%{transform:rotate(-2deg)}80%{transform:rotate(1deg)}}
@keyframes zb-tilt{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-3deg)}}
@keyframes zb-look{0%,35%,100%{transform:translate(0,0)}45%,85%{transform:translate(2.5px,-1.5px)}}
@keyframes zb-nodA{0%,100%{transform:translateY(0)}45%{transform:translateY(4px)}}
@keyframes zb-nodB{0%,100%{transform:translateY(0)}45%{transform:translateY(4px)}}
@media (prefers-reduced-motion: reduce){.zb-a{animation:none !important}}
`;

const g = (anim: string, origin: string, body: string, box = 'view-box') =>
  `<g class="zb-a" style="transform-box:${box};transform-origin:${origin};animation:${anim}">${body}</g>`;

function face(m: Mood, blink: string, look: string): string {
  const on = (list: Mood[]) => list.includes(m);
  const parts: string[] = [];
  if (on(['hello', 'oops'])) parts.push(g(blink, 'center', '<circle cx="84" cy="91" r="4.8" fill="#17100B"/><circle cx="116" cy="91" r="4.8" fill="#17100B"/><circle cx="85.6" cy="89.4" r="1.4" fill="#F3F0EA"/><circle cx="117.6" cy="89.4" r="1.4" fill="#F3F0EA"/>', 'fill-box'));
  if (on(['think'])) parts.push(`<g class="zb-a" style="animation:${look}"><circle cx="86" cy="88" r="4.8" fill="#17100B"/><circle cx="118" cy="88" r="4.8" fill="#17100B"/><circle cx="87.6" cy="86.4" r="1.4" fill="#F3F0EA"/><circle cx="119.6" cy="86.4" r="1.4" fill="#F3F0EA"/></g>`);
  if (on(['happy', 'cheer'])) parts.push('<g fill="#17100B"><path d="M78 93 Q84 84.5 90 93 Q84 89.5 78 93 Z"/><path d="M110 93 Q116 84.5 122 93 Q116 89.5 110 93 Z"/></g>');
  if (on(['sleep'])) parts.push('<g fill="#17100B"><path d="M78 90 Q84 96.5 90 90 Q84 93 78 90 Z"/><path d="M110 90 Q116 96.5 122 90 Q116 93 110 90 Z"/></g>');
  const brows: Record<Mood, string> = {
    hello: '<path d="M76 80.5 Q84 78.5 92 80.5 L92 83 Q84 81 76 83 Z"/><path d="M108 80.5 Q116 78.5 124 80.5 L124 83 Q116 81 108 83 Z"/>',
    oops: '<path d="M76 84 L92 78 L92 80.6 L76 86.6 Z"/><path d="M124 84 L108 78 L108 80.6 L124 86.6 Z"/>',
    happy: '<path d="M76 78 Q84 75.5 92 78 L92 80.5 Q84 78 76 80.5 Z"/><path d="M108 78 Q116 75.5 124 78 L124 80.5 Q116 78 108 80.5 Z"/>',
    cheer: '<path d="M76 78 Q84 75.5 92 78 L92 80.5 Q84 78 76 80.5 Z"/><path d="M108 78 Q116 75.5 124 78 L124 80.5 Q116 78 108 80.5 Z"/>',
    think: '<path d="M76 81 Q84 79.5 92 81 L92 83.5 Q84 82 76 83.5 Z"/><path d="M108 77 Q116 73.5 124 76 L124 78.5 Q116 76 108 79.5 Z"/>',
    sleep: '<path d="M76 83 Q84 82 92 83 L92 85.4 Q84 84.4 76 85.4 Z"/><path d="M108 83 Q116 82 124 83 L124 85.4 Q116 84.4 108 85.4 Z"/>',
  };
  parts.push(`<g fill="#33251C">${brows[m]}</g>`);
  if (on(['hello', 'think', 'sleep'])) parts.push('<rect x="94" y="130" width="12" height="2.4" rx="1.2" fill="#33251C"/>');
  if (on(['happy', 'cheer'])) parts.push('<path d="M92 129 Q100 136.5 108 129 Q100 133 92 129 Z" fill="#33251C"/>');
  if (on(['oops'])) parts.push('<path d="M93 134 Q100 128.5 107 134 Q100 131.5 93 134 Z" fill="#33251C"/>');
  return parts.join('');
}

export function zubrikSvg(opts: MascotOptions = {}): string {
  const m = opts.mood ?? 'hello';
  const size = opts.size ?? 200;
  const phase = opts.phase ?? 0;
  const off = (a: string) => (opts.still ? 'none' : a);
  let body = 'zb-breathe 4.8s ease-in-out infinite';
  if (m === 'happy') body = `zb-hop 560ms ${SPRING} 1 both`;
  if (m === 'cheer') body = `zb-hop 560ms ${SPRING} 2 both`;
  if (m === 'oops') body = 'none';
  if (m === 'sleep') body = 'zb-breathe 6.4s ease-in-out infinite';
  let head = 'none';
  if (m === 'oops') head = 'zb-shake 520ms ease-in-out 1 both';
  if (m === 'think') head = 'zb-tilt 3.2s ease-in-out infinite';
  if (opts.poke) head = `${opts.poke % 2 ? 'zb-nodA' : 'zb-nodB'} 440ms cubic-bezier(.2,0,0,1) 1`;
  const blink = off(`zb-blink 5.6s ${-phase}ms infinite`);
  const look = off('zb-look 4s ease-in-out infinite');
  const earL = off(m === 'sleep' ? 'none' : `zb-earL 8s ${-phase}ms ease-in-out infinite`);
  const earR = off(m === 'sleep' ? 'none' : `zb-earR 8s ${-phase - 3000}ms ease-in-out infinite`);
  const viewBox = opts.crop === 'head' ? '26 20 148 148' : '0 0 200 200';
  const headParts = [
    '<path d="M64 64 C46 64 33 52 33 29 C40 44 50 50 64 52 Z" fill="#E6DAC4"/>',
    '<path d="M33 29 C34 37 37 41 41 44 C36 44 33 40 32.5 35 Z" fill="#A8957A"/>',
    '<path d="M136 64 C154 64 167 52 167 29 C160 44 150 50 136 52 Z" fill="#E6DAC4"/>',
    '<path d="M167 29 C166 37 163 41 159 44 C164 44 167 40 167.5 35 Z" fill="#A8957A"/>',
    g(earL, '62px 86px', '<path d="M62 84 C52 76 38 76 28 82 C38 90 52 92 62 89 Z" fill="#7A5640"/>'),
    g(earR, '138px 86px', '<path d="M138 84 C148 76 162 76 172 82 C162 90 148 92 138 89 Z" fill="#7A5640"/>'),
    '<path d="M58 72 C58 54 76 46 100 46 C124 46 142 54 142 72 L138 124 C136 144 120 154 100 154 C80 154 64 144 62 124 Z" fill="#7A5640"/>',
    '<path d="M54 78 C52 46 74 31 100 31 C126 31 148 46 146 78 Q137 69 127 74 Q115 64 100 72 Q85 64 73 74 Q63 69 54 78 Z" fill="#33251C"/>',
    '<path d="M70 120 C70 108 84 103 100 103 C116 103 130 108 130 120 C130 135 117 144 100 144 C83 144 70 135 70 120 Z" fill="#C9AE92"/>',
    '<ellipse cx="88" cy="118" rx="4.4" ry="2.8" transform="rotate(20 88 118)" fill="#33251C"/>',
    '<ellipse cx="112" cy="118" rx="4.4" ry="2.8" transform="rotate(-20 112 118)" fill="#33251C"/>',
    face(m, blink, look),
  ].join('');
  const bodyParts = [
    '<path d="M22 166 C18 82 56 30 100 26 C144 30 182 82 178 166 Z" fill="#5C4130"/>',
    '<path d="M12 200 C16 142 50 116 100 116 C150 116 184 142 188 200 Z" fill="#5C4130"/>',
    '<path d="M74 140 C76 166 88 186 100 200 C112 186 124 166 126 140 Z" fill="#33251C"/>',
    g(off(head), '100px 160px', headParts),
  ].join('');
  return `<svg width="${size}" height="${size}" viewBox="${viewBox}" style="display:block;overflow:visible" aria-hidden="true">${g(off(body), '100px 200px', bodyParts)}</svg>`;
}

export function moodFor(result: { correct: boolean; typo: boolean } | null, streak: number): Mood {
  if (!result) return 'think';
  if (!result.correct) return 'oops';
  if (result.typo) return 'think';
  return streak > 0 && streak % 5 === 0 ? 'cheer' : 'happy';
}
