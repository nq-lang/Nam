// =====================================================================
// Design tokens + typography helpers, merged into one file.
// Tuned toward professional trading-terminal conventions: desaturated
// dark base, restrained accent palette (color reserved for exposure
// sign, not decoration), tabular numerals for all data values, and
// tighter chrome (thin borders, small radii) over "card" styling.
// =====================================================================

export const C = {
  // base surfaces - subtle elevation steps, not sharp card boundaries
  bg: "#0a0c0f",
  bgPanel: "#0e1114",
  bgElevated: "#14181d",
  bgInset: "#0c0e11",

  // borders - thin, low-contrast, structural rather than decorative
  border: "#1c2126",
  borderStrong: "#2a3038",
  divider: "#161a1f",

  // text - desaturated blue-grey scale, not pure grey
  text: "#dde2e8",
  textDim: "#7d8894",
  textFaint: "#4a525c",
  textMuted: "#5c6570",

  // signal colors - reserved exclusively for exposure sign / state
  accent: "#2dd4bf", // positive exposure
  accentRose: "#f0555f", // negative exposure
  accentAmber: "#e0a92e", // warnings / non-1x playback speed
  focus: "#4d8fd6", // spot price / active selection

  // chart-specific
  gridLine: "#161a1f",
  candleUp: "#2dd4bf",
  candleDown: "#f0555f",

  // typography
  fontMono: '"IBM Plex Mono", "SF Mono", "Roboto Mono", ui-monospace, monospace',
  fontUI: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',

  // radii - small and consistent; terminals aren't "card" UIs
  radiusSm: 2,
  radiusMd: 3,
};

/** Style object for any numeric data display — strikes, IV%, exposure
 * values, timestamps. Ensures digits align in columns (tabular-nums). */
export const numericStyle = {
  fontFamily: C.fontMono,
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum"',
};

/** Style object for section/control labels — slightly letter-spaced,
 * dimmed by default. */
export const labelStyle = {
  fontFamily: C.fontUI,
  letterSpacing: "0.02em",
  color: C.textDim,
};

/** Format an exposure value with K/M suffixing and a fixed decimal precision. */
export function fmtExposure(v, precision) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(precision)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(precision)}K`;
  return `${sign}${abs.toFixed(precision)}`;
}

/**
 * Normalize a value into [-1, 1] against a max magnitude, either linearly
 * or on a log scale (log preserves sign, compresses outliers).
 */
export function scaleValue(v, max, mode) {
  if (mode === "log") {
    const s = Math.sign(v);
    const lv = Math.log10(1 + Math.abs(v));
    const lmax = Math.log10(1 + max) || 1;
    return s * (lv / lmax);
  }
  return v / (max || 1);
}
