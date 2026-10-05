// Self-hosted fonts: cached with the app for offline use and shared with exercise frames by absolute URL.
import f0 from '@fontsource/geologica/files/geologica-latin-400-normal.woff2?url';
import f1 from '@fontsource/geologica/files/geologica-cyrillic-400-normal.woff2?url';
import f2 from '@fontsource/geologica/files/geologica-latin-600-normal.woff2?url';
import f3 from '@fontsource/geologica/files/geologica-cyrillic-600-normal.woff2?url';
import f4 from '@fontsource/geologica/files/geologica-latin-700-normal.woff2?url';
import f5 from '@fontsource/geologica/files/geologica-cyrillic-700-normal.woff2?url';
import f6 from '@fontsource/golos-text/files/golos-text-latin-400-normal.woff2?url';
import f7 from '@fontsource/golos-text/files/golos-text-cyrillic-400-normal.woff2?url';
import f8 from '@fontsource/golos-text/files/golos-text-latin-500-normal.woff2?url';
import f9 from '@fontsource/golos-text/files/golos-text-cyrillic-500-normal.woff2?url';
import f10 from '@fontsource/golos-text/files/golos-text-latin-600-normal.woff2?url';
import f11 from '@fontsource/golos-text/files/golos-text-cyrillic-600-normal.woff2?url';
import f12 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import f13 from '@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-400-normal.woff2?url';
import f14 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-normal.woff2?url';
import f15 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';
import f16 from '@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-500-normal.woff2?url';

const FACES: [string, number, string, string][] = [
  ['Geologica', 400, f0, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Geologica', 400, f1, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['Geologica', 600, f2, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Geologica', 600, f3, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['Geologica', 700, f4, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Geologica', 700, f5, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['Golos Text', 400, f6, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Golos Text', 400, f7, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['Golos Text', 500, f8, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Golos Text', 500, f9, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['Golos Text', 600, f10, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['Golos Text', 600, f11, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['JetBrains Mono', 400, f12, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['JetBrains Mono', 400, f13, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['JetBrains Mono', 400, f14, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  ['JetBrains Mono', 500, f15, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['JetBrains Mono', 500, f16, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
];

export function fontFaceCss(origin = location.origin): string {
  return FACES.map(([family, weight, url, range]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${new URL(url, origin + location.pathname).href}) format('woff2');unicode-range:${range}}`).join('\n');
}

export function installFonts() {
  const style = document.createElement('style');
  style.textContent = fontFaceCss();
  document.head.appendChild(style);
}
