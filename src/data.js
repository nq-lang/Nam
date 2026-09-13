// =====================================================================
// Data layer, merged into one file: normalized contract, mock adapter
// (current data source), the IBKR live-feed stub (Milestone 7 swap-in
// point), localStorage persistence, and dashboard model definitions.
// =====================================================================

// ---- Normalized data contract (spec §8.4) --------------------------
// Every data source adapter (mock, IBKR, or any future vendor) must
// produce a SnapshotSeries matching this shape. Nothing above the
// adapter boundary (panels, layout, playback) should know or care
// where the data came from.
//
// SnapshotSeries: { symbol, expiries: [{dte,label}], strikeStep, frames: Snapshot[] }
// Snapshot: { timestamp, underlyingPrice, strikes: [{strike, byExpiry: ExposureRecord[]}] }
// ExposureRecord: {
//   expiryDate, calendarDate, dte,
//   gammaExposure, vannaExposure, charmExposure, deltaExposure,
//   callExposure, putExposure,
//   iv (number|null), ivDelta (number|null), available (boolean)
// }

// ---- Mock adapter ----------------------------------------------------
// Produces synthetic-but-realistic strike/expiry/Greek/IV data, including
// sparse far-dated expiries (to exercise the IV grid's empty-state
// handling). This is the ONLY implementation right now.
export function makeMockSnapshotSeries(symbol, spot, numFrames = 60) {
  const expiries = [
    { dte: 0, label: "0DTE" },
    { dte: 1, label: "1DTE" },
    { dte: 2, label: "2DTE" },
    { dte: 5, label: "5DTE" },
    { dte: 9, label: "9DTE" },
    { dte: 16, label: "16DTE" },
    { dte: 30, label: "30DTE" },
    { dte: 44, label: "44DTE" },
    { dte: 65, label: "65DTE" },
    { dte: 93, label: "93DTE" },
  ];
  const baseDate = new Date();
  const expiryDates = expiries.map((e) => {
    const d = new Date(baseDate.getTime() + e.dte * 86400000);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const strikeStep = Math.round((spot * 0.005) / 5) * 5 || 5;
  const strikes = [];
  for (let i = -12; i <= 12; i++) strikes.push(Math.round((spot + i * strikeStep) / 5) * 5);

  const frames = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let f = 0; f < numFrames; f++) {
    const drift = Math.sin(f / 8) * spot * 0.002;
    const frameSpot = spot + drift;
    const rows = strikes.map((strike) => {
      const dist = (strike - frameSpot) / spot;
      const byExpiry = expiries.map((e, ei) => {
        const decay = Math.exp(-Math.abs(dist) * 18) * (1 + rand() * 0.3);
        const sign = dist > 0 ? 1 : -1;
        const gamma = sign * decay * (5e6 + rand() * 3e6) * (1 / (1 + e.dte * 0.15));
        const vanna = -sign * decay * (2e6 + rand() * 1.5e6) * (1 / (1 + e.dte * 0.2));
        const charm = sign * decay * (1e6 + rand() * 0.8e6) * (1 / (1 + e.dte * 0.25));
        const iv = 0.14 + Math.abs(dist) * 0.9 + e.dte * 0.002 + rand() * 0.01;
        // Far-dated expiries (44DTE+) sparsely list contracts at extreme
        // strikes - simulates real listed-contract gaps.
        const available = !(e.dte >= 44 && Math.abs(dist) > 0.045);
        return {
          expiryDate: e.label,
          calendarDate: expiryDates[ei],
          dte: e.dte,
          gammaExposure: gamma,
          vannaExposure: vanna,
          charmExposure: charm,
          deltaExposure: gamma * 0.4,
          callExposure: gamma > 0 ? gamma * 0.6 : gamma * 0.3,
          putExposure: gamma > 0 ? gamma * 0.4 : gamma * 0.7,
          iv: available ? iv : null,
          ivDelta: available ? (rand() - 0.5) * 0.004 : null,
          available,
        };
      });
      return { strike, byExpiry };
    });
    frames.push({
      timestamp: new Date(Date.now() - (numFrames - f) * 60000).toISOString(),
      underlyingPrice: frameSpot,
      strikes: rows,
    });
  }
  return { symbol, expiries, strikeStep, frames };
}

/** Spot price seeds used by the dashboard model picker for common symbols. */
export const MOCK_SPOT_BY_SYMBOL = { SPX: 5720, SPY: 572, QQQ: 486, NDX: 20140 };

// ---- IBKR live-data adapter — STUB ------------------------------------
// Intentionally unimplemented. Per the build kickoff, IBKR API access
// will be provided after the full terminal build is complete (Milestone
// 7). When that happens, implement fetchSnapshotSeries() (and optionally
// a streaming subscribeSnapshots()) so it returns/pushes data in the
// exact same shape as makeMockSnapshotSeries() above.
//
// No other vendor should be wired in here — this is reserved for IBKR
// specifically, per the original build brief.
//
// Swap-in point: in App.jsx's Terminal component, replace the
// `makeMockSnapshotSeries` import/call with `fetchSnapshotSeries` from
// here. Every panel consumes only the normalized SnapshotSeries shape
// and needs no changes.
export async function fetchSnapshotSeries(symbol) {
  throw new Error(
    "fetchSnapshotSeries() is not implemented yet. Wire up IBKR API access here once credentials are available (Milestone 7)."
  );
}

export function subscribeSnapshots(symbol, onSnapshot) {
  throw new Error("subscribeSnapshots() is not implemented yet.");
}

// ---- Persistence -------------------------------------------------------
// Uses localStorage for now (Milestone 8 calls for real backend
// persistence + entitlements; this is the seam to swap when that lands —
// replace the get/set bodies with API calls and every caller stays the same).
const DASHBOARDS_KEY = "options-terminal:dashboards";
const LAYOUT_PREFIX = "options-terminal:split:";

const DEFAULT_DASHBOARDS = [
  { id: "d1", name: "SPX 0DTE Desk", symbol: "SPX", modelId: "gex-classic", model: "GEX Classic", updated: "2h ago" },
  { id: "d2", name: "QQQ Vol Surface", symbol: "QQQ", modelId: "iv-term", model: "IV Term Structure", updated: "1d ago" },
];

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function loadDashboards() {
  if (typeof window === "undefined") return DEFAULT_DASHBOARDS;
  const raw = window.localStorage.getItem(DASHBOARDS_KEY);
  if (!raw) {
    window.localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(DEFAULT_DASHBOARDS));
    return DEFAULT_DASHBOARDS;
  }
  return safeParse(raw, DEFAULT_DASHBOARDS);
}

export function saveDashboards(dashboards) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dashboards));
}

/** Persisted resizable-split ratios, keyed by split id (see useSplit in hooks.js). */
export function loadSplitRatio(id, fallback) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(LAYOUT_PREFIX + id);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function saveSplitRatio(id, ratio) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAYOUT_PREFIX + id, String(ratio));
}

// ---- Dashboard model definitions ---------------------------------------
// Each model declares which of the five panel types it shows, and for
// the Greek-surface panels, which two Greeks populate them. The Terminal
// component (in App.jsx) reads this to build the grid dynamically per
// dashboard, so different models produce genuinely different layouts
// rather than always showing all five panels.
export const MODELS = [
  {
    id: "gex-classic",
    name: "GEX Classic",
    desc: "Dealer gamma exposure by strike, net convention.",
    panels: ["exposure", "greekA", "greekB", "ivGrid", "surface3d"],
    greeks: ["Gamma", "Vanna"],
  },
  {
    id: "gex-callput",
    name: "GEX Call/Put Split",
    desc: "Gamma exposure split into call and put sub-bars.",
    panels: ["exposure", "greekA", "greekB", "ivGrid", "surface3d"],
    greeks: ["Gamma", "Charm"],
  },
  {
    id: "vanna-charm",
    name: "Vanna/Charm Desk",
    desc: "Cross-exposure surfaces for vol-of-spot sensitivity.",
    panels: ["greekA", "greekB"],
    greeks: ["Vanna", "Charm"],
  },
  {
    id: "iv-term",
    name: "IV Term Structure",
    desc: "Fixed-strike IV grid + 3D surface, no exposure bars.",
    panels: ["ivGrid", "surface3d"],
    greeks: [],
  },
];

export const AVAILABLE_SYMBOLS = ["SPX", "SPY", "QQQ", "NDX"];

export function getModelById(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}
