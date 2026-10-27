// Workspace brand colour: validation and the shades the app derives from it.
// Used by the server (to refuse bad input) and the browser (live preview + theme). Hex only, 6 digits.
export const MIN_CONTRAST = 4.5; // WCAG AA for normal text; buttons and chips put white text on the colour

export const normalizeHex = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
};

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const [r, g, b] = channels(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** WCAG contrast ratio of white text on this colour (1 to 21). */
export const contrastOnWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

const mix = (hex, other, amount) => '#' + channels(hex).map((c, i) => Math.round(c + (channels(other)[i] - c) * amount).toString(16).padStart(2, '0')).join('');

/** [primary, darker hover shade, light tint] like the built-in accents in client/src/theme.js. */
export const shades = (hex) => [hex, mix(hex, '#000000', 0.18), mix(hex, '#ffffff', 0.9)];

/** Returns { ok, hex, error }. Empty means "use the default look". */
export function checkBrandColor(v) {
  if (v === undefined || v === null || String(v).trim() === '') return { ok: true, hex: '' };
  const hex = normalizeHex(v);
  if (!hex) return { ok: false, error: 'Use a colour like #1a56db (six hex digits)' };
  if (contrastOnWhite(hex) < MIN_CONTRAST) return { ok: false, hex, error: 'This colour is too light for white button text. Choose a darker shade.' };
  return { ok: true, hex };
}
