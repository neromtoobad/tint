// Builds the final Tint logo SVGs: the mark (pebble in shades) and the "tint" wordmark
// outlined from Bricolage Grotesque ExtraBold, so the files need no font.
// Usage: node brand/tools/logo.mjs
import opentype from 'opentype.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'logo');
fs.mkdirSync(out, { recursive: true });

export const C = {
  paper: '#F3EFE9', white: '#FFFFFF', ink: '#121318', cobalt: '#1B2A6B', deep: '#0B1230', sky: '#9DB4FF', frameLight: '#B9C0CC', frameDark: '#C9CDD6',
};

// The mark, drawn on a 120×120 grid, tilted 8° like the mascot.
function mark({ body, frame, lens, id }) {
  const g = lens === 'dark'
    ? `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070B1F"/><stop offset=".55" stop-color="${C.cobalt}"/><stop offset="1" stop-color="#7F9BFF"/></linearGradient>`
    : `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#C8D4FF"/><stop offset="1" stop-color="#8FA8FF"/></linearGradient>`;
  return {
    defs: g,
    body: `<g transform="rotate(-8 60 62)">
    <path d="M60 8C81 8 99 35 99 66C99 96 81 113 60 113C39 113 21 96 21 66C21 35 39 8 60 8Z" fill="${body}"/>
    <path d="M18 47C33 42.5 87 42.5 102 47" fill="none" stroke="${frame}" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M24 46H57C58 46 58.5 47 58 48.5L55.5 60C54 67 49 71 42 71H33C26 71 22 66 22.5 58L23 49C23 47 23.5 46 24 46Z" fill="url(#${id})"/>
    <path d="M96 46H63C62 46 61.5 47 62 48.5L64.5 60C66 67 71 71 78 71H87C94 71 98 66 97.5 58L97 49C97 47 96.5 46 96 46Z" fill="url(#${id})"/>
  </g>`,
  };
}

const variants = {
  ink: { body: C.ink, frame: C.frameLight, lens: 'light' },       // on light backgrounds
  cream: { body: C.paper, frame: C.frameDark, lens: 'dark' },     // on cobalt / dark backgrounds
};

const font = opentype.loadSync(path.join(here, '..', 'fonts', 'bricolage-96-800.ttf'));
function word(text, size, fill) {
  // tight tracking like the posters (-0.05em)
  const glyphs = font.stringToGlyphs(text);
  let x = 0; const parts = [];
  const scale = size / font.unitsPerEm;
  glyphs.forEach((gl, i) => {
    parts.push(gl.getPath(x, size * 0.8, size).toPathData(2));
    x += gl.advanceWidth * scale - size * 0.05;
    if (i < glyphs.length - 1) x += font.getKerningValue(gl, glyphs[i + 1]) * scale;
  });
  const bb = font.getPath(text, 0, size * 0.8, size).getBoundingBox();
  return { d: parts.join(''), width: x + size * 0.05, top: bb.y1, bottom: bb.y2, fill };
}

const files = {};
for (const [name, v] of Object.entries(variants)) {
  const m = mark({ ...v, id: 'l' + name });
  files[`tint-mark-${name}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>${m.defs}</defs>${m.body}</svg>`;
  // lockup: mark + wordmark, wordmark cap height matched to the mark
  const w = word('tint', 150, name === 'ink' ? C.ink : C.paper);
  const H = 150, gap = 22;
  const W = Math.ceil(H + gap + w.width);
  const dy = (H - (w.bottom + w.top)) / 2; // centre the word on the mark
  files[`tint-lockup-${name}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs>${m.defs}</defs><g transform="scale(${H / 120})">${m.body}</g><path transform="translate(${H + gap} ${dy.toFixed(2)})" d="${w.d}" fill="${w.fill}"/></svg>`;
}
// app icon: cream mark on a cobalt rounded square
{
  const m = mark({ ...variants.cream, id: 'licon' });
  files['tint-icon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>${m.defs}</defs><rect width="120" height="120" rx="28" fill="${C.cobalt}"/><g transform="translate(14 14) scale(.7667)">${m.body}</g></svg>`;
}
for (const [f, s] of Object.entries(files)) { fs.writeFileSync(path.join(out, f), s); console.log(path.join(out, f)); }
