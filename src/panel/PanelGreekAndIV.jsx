import { useEffect, useMemo, useRef, useState } from "react";
import { C, fmtExposure } from "../theme";
import { Segmented, Dropdown, ColorKeyLegend } from "../ui";

// =====================================================================
// Shared surface math (used by Panels 2 & 3, the Greek exposure surfaces)
// =====================================================================

const SURFACE_GREEKS = [
  { id: "Gamma", key: "gammaExposure" },
  { id: "Vanna", key: "vannaExposure" },
  { id: "Charm", key: "charmExposure" },
];
const EXPIRY_SCOPES = ["0DTE", "1DTE", "5DTE", "10DTE", "All"];
const TIME_RESOLUTIONS = ["1m", "5m", "10m", "15m", "30m"];

function buildSurfaceGrid(allFrames, frameIdx, greekKey, expiryScope, lookback = 40) {
  const start = Math.max(0, frameIdx - lookback + 1);
  const framesSlice = allFrames.slice(start, frameIdx + 1);
  const strikes = allFrames[frameIdx].strikes.map((s) => s.strike);

  const expiryFilter = (byExpiry) => {
    if (expiryScope === "All") return byExpiry;
    const dteMap = { "0DTE": 0, "1DTE": 1, "5DTE": 5, "10DTE": 9 };
    const target = dteMap[expiryScope];
    return byExpiry.filter((e) => e.dte === target);
  };

  const grid = framesSlice.map((f) =>
    f.strikes.map((s) => {
      const filtered = expiryFilter(s.byExpiry);
      return filtered.reduce((sum, e) => sum + (e[greekKey] ?? 0), 0);
    })
  );

  const candles = framesSlice.map((f, i) => {
    const prev = i > 0 ? framesSlice[i - 1].underlyingPrice : f.underlyingPrice;
    return { t: i, open: prev, close: f.underlyingPrice, high: Math.max(prev, f.underlyingPrice) * 1.0006, low: Math.min(prev, f.underlyingPrice) * 0.9994 };
  });

  return { grid, strikes, candles };
}

function bilinearSample(grid, tf, sf) {
  const nT = grid.length;
  const nS = grid[0]?.length ?? 0;
  if (nT === 0 || nS === 0) return 0;
  const t0 = Math.max(0, Math.min(nT - 1, Math.floor(tf)));
  const t1 = Math.min(nT - 1, t0 + 1);
  const s0 = Math.max(0, Math.min(nS - 1, Math.floor(sf)));
  const s1 = Math.min(nS - 1, s0 + 1);
  const ft = tf - t0;
  const fs = sf - s0;
  const v00 = grid[t0][s0],
    v10 = grid[t1][s0],
    v01 = grid[t0][s1],
    v11 = grid[t1][s1];
  const top = v00 * (1 - ft) + v10 * ft;
  const bot = v01 * (1 - ft) + v11 * ft;
  return top * (1 - fs) + bot * fs;
}

function surfaceColor(norm) {
  const a = Math.min(1, Math.abs(norm));
  if (norm >= 0) {
    return [Math.round(11 + a * (63 - 11)), Math.round(14 + a * (214 - 14)), Math.round(17 + a * (194 - 17))];
  }
  return [Math.round(11 + a * (226 - 11)), Math.round(14 + a * (89 - 14)), Math.round(17 + a * (107 - 17))];
}

/**
 * Panels 2 & 3 — Greek Exposure Surfaces (spec §5). Smooth interpolated
 * color field, rendered by drawing into a small offscreen buffer and
 * letting the canvas upscale it with smoothing. Each instance is fully
 * independently configurable (own Greek, own expiry scope, own opacity/range).
 */
export function GreekSurfacePanel({ allFrames, frameIdx, hoveredStrike, onCrossPanelHover, defaultGreek = "Gamma" }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 400, h: 260 });
  const [greek, setGreek] = useState(defaultGreek);
  const [expiryScope, setExpiryScope] = useState("All");
  const [timeRes, setTimeRes] = useState("5m");
  const [opacity, setOpacity] = useState(0.9);
  const [range, setRange] = useState(150);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: Math.max(200, r.width), h: Math.max(120, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const greekDef = SURFACE_GREEKS.find((g) => g.id === greek);
  const { grid, strikes, candles } = useMemo(() => buildSurfaceGrid(allFrames, frameIdx, greekDef.key, expiryScope), [allFrames, frameIdx, greekDef, expiryScope]);
  const rangeAbs = range * 1000;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const padTop = 18,
      padBottom = 22,
      padLeft = 4,
      padRight = 4;
    const plotW = Math.max(1, dims.w - padLeft - padRight);
    const plotH = Math.max(1, dims.h - padTop - padBottom);

    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = dims.w + "px";
    canvas.style.height = dims.h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);

    const nT = grid.length;
    const nS = grid[0]?.length ?? 0;
    if (nT < 2 || nS < 2) return;

    const bufW = Math.min(160, Math.max(40, Math.round(plotW / 4)));
    const bufH = Math.min(120, Math.max(30, Math.round(plotH / 4)));
    const off = document.createElement("canvas");
    off.width = bufW;
    off.height = bufH;
    const octx = off.getContext("2d");
    const imgData = octx.createImageData(bufW, bufH);

    for (let py = 0; py < bufH; py++) {
      const sf = ((bufH - 1 - py) / (bufH - 1)) * (nS - 1);
      for (let px = 0; px < bufW; px++) {
        const tf = (px / (bufW - 1)) * (nT - 1);
        const v = bilinearSample(grid, tf, sf);
        const norm = Math.max(-1, Math.min(1, v / rangeAbs));
        const [r, g, b] = surfaceColor(norm);
        const idx = (py * bufW + px) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    octx.putImageData(imgData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = opacity;
    ctx.drawImage(off, 0, 0, bufW, bufH, padLeft, padTop, plotW, plotH);
    ctx.globalAlpha = 1;

    const strikeMinGrid = Math.min(...strikes);
    const strikeMaxGrid = Math.max(...strikes);
    const gridStep = Math.pow(10, Math.floor(Math.log10((strikeMaxGrid - strikeMinGrid) / 6 || 1)));
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    for (let gv = Math.ceil(strikeMinGrid / gridStep) * gridStep; gv <= strikeMaxGrid; gv += gridStep) {
      const gy = padTop + (1 - (gv - strikeMinGrid) / (strikeMaxGrid - strikeMinGrid || 1)) * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(padLeft + plotW, gy);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(230,233,237,0.85)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let started = false;
    for (let px = 0; px < bufW; px++) {
      const tf = (px / (bufW - 1)) * (nT - 1);
      let crossSf = null;
      let prevV = bilinearSample(grid, tf, 0);
      for (let sIdx = 1; sIdx < nS; sIdx++) {
        const v = bilinearSample(grid, tf, sIdx);
        if ((prevV < 0 && v >= 0) || (prevV >= 0 && v < 0)) {
          const frac = prevV === v ? 0 : -prevV / (v - prevV);
          crossSf = sIdx - 1 + frac;
          break;
        }
        prevV = v;
      }
      if (crossSf !== null) {
        const x = padLeft + (px / (bufW - 1)) * plotW;
        const y = padTop + (1 - crossSf / (nS - 1)) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();

    const strikeMin = Math.min(...strikes);
    const strikeMax = Math.max(...strikes);
    const priceToY = (p) => padTop + (1 - (p - strikeMin) / (strikeMax - strikeMin || 1)) * plotH;
    const candleW = Math.max(1.5, (plotW / nT) * 0.6);
    candles.forEach((c, i) => {
      const x = padLeft + (i / (nT - 1)) * plotW;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? C.accent : C.accentRose;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(c.high));
      ctx.lineTo(x, priceToY(c.low));
      ctx.stroke();
      ctx.fillStyle = up ? C.accent : C.accentRose;
      const yTop = priceToY(Math.max(c.open, c.close));
      const yBot = priceToY(Math.min(c.open, c.close));
      ctx.fillRect(x - candleW / 2, yTop, candleW, Math.max(1, yBot - yTop));
    });

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = C.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft + plotW - 0.5, padTop);
    ctx.lineTo(padLeft + plotW - 0.5, padTop + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = C.textFaint;
    ctx.font = "8.5px " + C.fontMono;
    ctx.textAlign = "left";
    ctx.fillText(String(strikeMax), padLeft + 2, padTop + 9);
    ctx.textBaseline = "bottom";
    ctx.fillText(String(strikeMin), padLeft + 2, padTop + plotH - 2);
    ctx.textBaseline = "alphabetic";

    if (hoveredStrike != null && hoveredStrike >= strikeMin && hoveredStrike <= strikeMax) {
      const y = priceToY(hoveredStrike);
      ctx.strokeStyle = C.text;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [grid, strikes, candles, dims, opacity, rangeAbs, hoveredStrike]);

  const handleMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const padTop = 18,
      padLeft = 4,
      padRight = 4;
    const plotW = dims.w - padLeft - padRight;
    const plotH = dims.h - padTop - 22;
    const strikeMin = Math.min(...strikes);
    const strikeMax = Math.max(...strikes);
    const strikeFrac = 1 - (y - padTop) / plotH;
    const strikeVal = strikeMin + strikeFrac * (strikeMax - strikeMin);
    const nearestStrike = strikes.reduce((best, s) => (Math.abs(s - strikeVal) < Math.abs(best - strikeVal) ? s : best), strikes[0]);

    const nT = grid.length;
    const tf = ((x - padLeft) / plotW) * (nT - 1);
    const sIdx = strikes.indexOf(nearestStrike);
    const sf = strikes.length - 1 - sIdx;
    const value = bilinearSample(grid, tf, sf);

    setCursor({ x, y, strike: nearestStrike, value });
    onCrossPanelHover && onCrossPanelHover(nearestStrike);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "5px 8px", borderBottom: `1px solid ${C.divider}`, background: C.bgInset, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Segmented options={SURFACE_GREEKS.map((g) => g.id)} value={greek} onChange={setGreek} />
          <Segmented options={EXPIRY_SCOPES} value={expiryScope} onChange={setExpiryScope} />
          <Dropdown value={timeRes} options={TIME_RESOLUTIONS} onChange={setTimeRes} />
          <ColorKeyLegend />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 100 }}>
            <span style={{ color: C.textDim, whiteSpace: "nowrap" }}>Opacity</span>
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ flex: 1 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 100 }}>
            <span style={{ color: C.textDim, whiteSpace: "nowrap" }}>Range ±{range}</span>
            <input type="range" min={20} max={500} step={10} value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ flex: 1 }} />
          </div>
        </div>
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas ref={canvasRef} onMouseMove={handleMove} onMouseLeave={() => setCursor(null)} style={{ display: "block", cursor: "crosshair" }} />
        {cursor && (
          <div
            style={{
              position: "absolute",
              left: Math.min(cursor.x + 10, dims.w - 130),
              top: Math.max(0, cursor.y - 26),
              background: C.bgElevated,
              border: `1px solid ${C.borderStrong}`,
              borderRadius: C.radiusMd,
              padding: "4px 7px",
              fontSize: 10,
              fontFamily: C.fontMono,
              color: C.text,
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
          >
            {cursor.strike} · {greek.toUpperCase()} <span style={{ color: cursor.value >= 0 ? C.accent : C.accentRose }}>{fmtExposure(cursor.value, 1)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Panel 4 — Fixed-Strike IV Heatmap Grid (spec §6)
// =====================================================================

function ivColor(iv, colMin, colMax) {
  if (iv == null) return null;
  const t = colMax > colMin ? (iv - colMin) / (colMax - colMin) : 0.5;
  const r = Math.round(63 + t * (226 - 63));
  const g = Math.round(214 + t * (89 - 214));
  const b = Math.round(155 + t * (107 - 155));
  return `rgb(${r},${g},${b})`;
}

function IVGridRow({ strike, isSpot, isHoveredRow, rowH, byExpiry, domains, onEnter, onLeave }) {
  return (
    <>
      <div
        style={{
          height: rowH,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 8px",
          fontSize: 10,
          fontFamily: C.fontMono,
          fontWeight: isSpot ? 700 : 400,
          color: isSpot ? C.text : C.textDim,
          borderTop: isSpot ? `1px solid ${C.focus}` : `1px solid ${C.divider}`,
          position: "sticky",
          left: 0,
          background: C.bgPanel,
          zIndex: 1,
          outline: isHoveredRow ? `1px solid ${C.text}` : "none",
        }}
      >
        {strike}
      </div>
      {byExpiry.map((e, j) => {
        const { min, max } = domains[j] || {};
        const bg = e.iv != null ? ivColor(e.iv, min, max) : "transparent";
        return (
          <div
            key={e.expiryDate}
            onMouseEnter={(ev) => {
              const rect = ev.currentTarget.getBoundingClientRect();
              onEnter({ strike, expiryLabel: e.expiryDate, iv: e.iv, ivDelta: e.ivDelta, timestamp: "last tick", rect });
            }}
            onMouseLeave={onLeave}
            style={{
              height: rowH,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontFamily: C.fontMono,
              borderLeft: `1px solid ${C.divider}`,
              borderTop: isSpot ? `1px solid ${C.focus}` : `1px solid transparent`,
              background: bg || "transparent",
              color: e.iv != null ? "#0a0d10" : C.textFaint,
              cursor: "default",
              outline: isHoveredRow ? `1px solid rgba(221,226,232,0.4)` : "none",
            }}
          >
            {e.iv != null ? (
              <>
                <span style={{ fontWeight: 600 }}>{(e.iv * 100).toFixed(1)}</span>
                <span style={{ fontSize: 7, opacity: 0.75 }}>
                  {e.ivDelta >= 0 ? "+" : ""}
                  {(e.ivDelta * 100).toFixed(1)}
                </span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Panel 4 — Fixed-Strike IV Heatmap Grid (spec §6). Rows = strike
 * (descending), columns = expiry/DTE. Cell = IV% plus a signed
 * delta-from-prior. Spot-price divider row, explicit empty-state dash
 * for strikes with no listed contract at a given DTE, per-cell
 * full-precision hover, column-vs-global color-scale toggle.
 */
export function IVGrid({ frame, hoveredStrike, onCrossPanelHover, playbackSpeed }) {
  const [scaleMode, setScaleMode] = useState("column");
  const [hoverCell, setHoverCell] = useState(null);
  const scrollRef = useRef(null);

  const sortedStrikes = useMemo(() => frame.strikes.slice().sort((a, b) => b.strike - a.strike), [frame]);
  const expiryList = frame.strikes[0]?.byExpiry ?? [];

  const domains = useMemo(() => {
    if (scaleMode === "global") {
      let min = Infinity,
        max = -Infinity;
      frame.strikes.forEach((s) =>
        s.byExpiry.forEach((e) => {
          if (e.iv != null) {
            min = Math.min(min, e.iv);
            max = Math.max(max, e.iv);
          }
        })
      );
      return expiryList.map(() => ({ min, max }));
    }
    return expiryList.map((_, j) => {
      let min = Infinity,
        max = -Infinity;
      frame.strikes.forEach((s) => {
        const iv = s.byExpiry[j]?.iv;
        if (iv != null) {
          min = Math.min(min, iv);
          max = Math.max(max, iv);
        }
      });
      return { min, max };
    });
  }, [frame, expiryList, scaleMode]);

  const colW = 78;
  const strikeColW = 64;
  const rowH = 22;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: `1px solid ${C.divider}`, background: C.bgInset }}>
        <span style={{ fontSize: 9.5, color: C.textDim, fontFamily: C.fontMono, letterSpacing: "0.03em" }}>SCALE</span>
        <Segmented options={["column", "global"]} value={scaleMode} onChange={setScaleMode} />
        <div style={{ flex: 1 }} />
        {playbackSpeed !== 1 && (
          <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.accentAmber, border: `1px solid ${C.accentAmber}`, borderRadius: C.radiusSm, padding: "1px 5px" }} title="Shared master clock playback speed">
            {playbackSpeed}×
          </span>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: `${strikeColW}px repeat(${expiryList.length}, ${colW}px)`, minWidth: "max-content" }}>
          <div style={{ position: "sticky", top: 0, left: 0, zIndex: 3, background: C.bgElevated, borderBottom: `1px solid ${C.borderStrong}` }} />
          {expiryList.map((e) => (
            <div
              key={e.expiryDate}
              style={{ position: "sticky", top: 0, zIndex: 2, background: C.bgElevated, borderBottom: `1px solid ${C.borderStrong}`, borderLeft: `1px solid ${C.divider}`, padding: "4px 6px", textAlign: "center", fontSize: 9, fontFamily: C.fontMono, color: C.textDim, lineHeight: 1.3 }}
            >
              <div style={{ fontWeight: 600, color: C.text }}>{e.expiryDate}</div>
              <div style={{ color: C.textFaint, fontSize: 8 }}>{e.calendarDate}</div>
            </div>
          ))}

          {sortedStrikes.map((s) => {
            const step = frame.strikes[1]?.strike - frame.strikes[0]?.strike;
            const isSpot = Math.abs(s.strike - frame.underlyingPrice) < (step ? Math.abs(step) / 2 : 3);
            const isHoveredRow = hoveredStrike === s.strike;
            return (
              <IVGridRow
                key={s.strike}
                strike={s.strike}
                isSpot={isSpot}
                isHoveredRow={isHoveredRow}
                rowH={rowH}
                byExpiry={s.byExpiry}
                domains={domains}
                onEnter={(cellInfo) => {
                  const scrollRect = scrollRef.current?.getBoundingClientRect();
                  setHoverCell({ ...cellInfo, scrollRect });
                  onCrossPanelHover && onCrossPanelHover(s.strike);
                }}
                onLeave={() => setHoverCell(null)}
              />
            );
          })}
        </div>

        {hoverCell && hoverCell.rect && (
          <div
            style={{
              position: "absolute",
              left: hoverCell.rect.right - (hoverCell.scrollRect?.left ?? 0) + 12,
              top: hoverCell.rect.top - (hoverCell.scrollRect?.top ?? 0),
              background: C.bgElevated,
              border: `1px solid ${C.borderStrong}`,
              borderRadius: C.radiusMd,
              padding: "6px 9px",
              fontSize: 10,
              fontFamily: C.fontMono,
              color: C.text,
              pointerEvents: "none",
              zIndex: 10,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              {hoverCell.strike} · {hoverCell.expiryLabel}
            </div>
            {hoverCell.iv != null ? (
              <>
                <div style={{ color: C.textDim }}>
                  IV: <span style={{ color: C.text }}>{(hoverCell.iv * 100).toFixed(3)}%</span>
                </div>
                <div style={{ color: C.textDim }}>
                  Δ prior:{" "}
                  <span style={{ color: hoverCell.ivDelta >= 0 ? C.accent : C.accentRose }}>
                    {hoverCell.ivDelta >= 0 ? "+" : ""}
                    {(hoverCell.ivDelta * 100).toFixed(3)}
                  </span>
                </div>
                <div style={{ color: C.textFaint, fontSize: 9.5 }}>{hoverCell.timestamp}</div>
              </>
            ) : (
              <div style={{ color: C.textFaint }}>No listed contracts at this DTE/strike</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
