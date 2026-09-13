import { useEffect, useMemo, useRef, useState } from "react";
import { C, fmtExposure, scaleValue } from "../theme";
import { Chip, Segmented, Dropdown } from "../ui";

const METRICS = [
  { id: "GEX", label: "GEX", key: "gammaExposure" },
  { id: "DEX", label: "DEX", key: "deltaExposure" },
  { id: "VEX", label: "VEX", key: "vannaExposure" },
  { id: "CEX", label: "CEX", key: "charmExposure" },
];
const PARTICIPANTS = ["MM", "All", "Retail"];

function StrikeInsightPopover({ popover, metricDef, precision, onClose }) {
  const { strike, x, y, row } = popover;
  return (
    <div
      style={{
        position: "absolute",
        left: Math.min(x + 10, 320),
        top: Math.max(0, y - 10),
        background: C.bgElevated,
        border: `1px solid ${C.borderStrong}`,
        borderRadius: C.radiusMd,
        padding: "9px 11px",
        fontSize: 10.5,
        color: C.text,
        boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
        zIndex: 30,
        minWidth: 190,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontFamily: C.fontMono, fontSize: 11 }}>{strike}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 11 }}>
          ✕
        </button>
      </div>
      <div style={{ color: C.textDim, marginBottom: 6, fontSize: 10 }}>
        Net {metricDef.label}:{" "}
        <span style={{ color: row.value >= 0 ? C.accent : C.accentRose, fontWeight: 600, fontFamily: C.fontMono }}>
          {fmtExposure(row.value, precision)}
        </span>
      </div>
      <div style={{ maxHeight: 140, overflow: "auto" }}>
        {row.byExpiry.map((e) => {
          const v = e[metricDef.key] ?? 0;
          return (
            <div key={e.expiryDate} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderTop: `1px solid ${C.divider}`, fontSize: 10 }}>
              <span style={{ color: C.textDim, fontFamily: C.fontMono }}>{e.expiryDate}</span>
              <span style={{ color: v >= 0 ? C.accent : C.accentRose, fontFamily: C.fontMono }}>{fmtExposure(v, precision)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Panel 1 — Strike Exposure Bar Chart (spec §4). Canvas-rendered since it
 * redraws every playback tick across potentially hundreds of strike rows.
 * Renders a hybrid chart + heat-cell table: horizontal net/call-put bars
 * on the left, per-expiry heat-shaded numeric columns on the right.
 */
export function Panel1Chart({ frame, expiries, onCrossPanelHover, hoveredStrike, settings, setSettings }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 600, h: 400 });
  const [viewMode, setViewMode] = useState("Chart");
  const [metric, setMetric] = useState("GEX");
  const [agg, setAgg] = useState("Net");
  const [scope, setScope] = useState("0DTE only");
  const [participant, setParticipant] = useState("MM");
  const [cumulative, setCumulative] = useState(false);
  const [popover, setPopover] = useState(null);
  const [hoverRow, setHoverRow] = useState(null);

  const metricDef = METRICS.find((m) => m.id === metric);
  const spot = frame.underlyingPrice;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: Math.max(200, r.width), h: Math.max(150, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    return frame.strikes
      .slice()
      .sort((a, b) => b.strike - a.strike) // §4: strikes sorted descending top-to-bottom
      .map((s) => {
        let val = 0,
          callVal = 0,
          putVal = 0;
        const expiriesToUse = scope === "0DTE only" ? [s.byExpiry[0]] : s.byExpiry;
        expiriesToUse.forEach((e) => {
          if (!e) return;
          const base = e[metricDef.key] ?? 0;
          val += base;
          const callFrac = base >= 0 ? 0.6 : 0.3;
          callVal += base * callFrac;
          putVal += base * (1 - callFrac);
        });
        return { strike: s.strike, value: val, callVal, putVal, byExpiry: s.byExpiry };
      });
  }, [frame, scope, metricDef]);

  const maxAbs = useMemo(() => rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 1), [rows]);
  const maxCellAbs = useMemo(() => {
    let m = 1;
    frame.strikes.forEach((s) => s.byExpiry.forEach((e) => (m = Math.max(m, Math.abs(e[metricDef.key] ?? 0)))));
    return m;
  }, [frame, metricDef]);

  const strikeStep = expiries.strikeStep || 5;
  const rowH = 20;
  const chartAreaWidth = viewMode === "Chart" ? Math.max(160, dims.w * 0.42) : 0;
  const cellTableWidth = dims.w - chartAreaWidth - 70;
  const nExpCols = frame.strikes[0]?.byExpiry.length ?? 1;
  const cellW = Math.max(34, cellTableWidth / nExpCols);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = dims.w + "px";
    canvas.style.height = dims.h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dims.w, dims.h);
    ctx.font = "10px " + C.fontMono;
    ctx.textBaseline = "middle";

    const strikeColW = 46;
    const barX = strikeColW;
    const barW = viewMode === "Chart" ? chartAreaWidth - strikeColW : 0;
    const barMidX = barX + barW / 2;
    const tableX = barX + barW;

    rows.forEach((r, i) => {
      const y = i * rowH;
      if (y > dims.h) return;
      const isSpot = Math.abs(r.strike - spot) < strikeStep / 2;

      if (isSpot) {
        ctx.strokeStyle = C.focus;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + rowH);
        ctx.lineTo(dims.w, y + rowH);
        ctx.stroke();
      }

      ctx.fillStyle = isSpot ? C.text : C.textDim;
      ctx.font = isSpot ? "600 10px " + C.fontMono : "10px " + C.fontMono;
      ctx.textAlign = "right";
      ctx.fillText(String(r.strike), strikeColW - 6, y + rowH / 2);

      if (viewMode === "Chart") {
        ctx.strokeStyle = C.border;
        ctx.beginPath();
        ctx.moveTo(barMidX, y + 2);
        ctx.lineTo(barMidX, y + rowH - 2);
        ctx.stroke();

        const drawBar = (val, offsetTop, h, alphaMul = 1) => {
          const norm = scaleValue(val, maxAbs, settings.scale);
          const w = Math.abs(norm) * (barW / 2 - 4);
          const x0 = val >= 0 ? barMidX : barMidX - w;
          ctx.fillStyle = val >= 0 ? C.accent : C.accentRose;
          ctx.globalAlpha = settings.opacity * alphaMul;
          ctx.fillRect(x0, y + offsetTop, w, h);
          ctx.globalAlpha = 1;
        };

        if (agg === "Net") {
          drawBar(r.value, 3, rowH - 6);
        } else {
          drawBar(r.callVal, 2, (rowH - 5) / 2, 1);
          drawBar(r.putVal, rowH / 2 + 1, (rowH - 5) / 2, 0.65);
        }
      }

      r.byExpiry.forEach((e, j) => {
        const val = e[metricDef.key] ?? 0;
        const cx = tableX + j * cellW;
        if (cx > dims.w) return;
        const norm = Math.min(1, Math.abs(scaleValue(val, maxCellAbs, settings.scale)));
        const color = val >= 0 ? C.accent : C.accentRose;
        ctx.globalAlpha = 0.12 + norm * 0.7 * settings.opacity;
        ctx.fillStyle = color;
        ctx.fillRect(cx, y + 1, cellW - 1, rowH - 2);
        ctx.globalAlpha = 1;

        ctx.fillStyle = norm > 0.55 ? "#0a0d10" : C.text;
        ctx.textAlign = "center";
        ctx.font = "9px " + C.fontMono;
        ctx.fillText(fmtExposure(val, settings.precision), cx + cellW / 2, y + rowH / 2);
      });
    });

    if (nExpCols) {
      ctx.fillStyle = C.textFaint;
      ctx.font = "8.5px " + C.fontMono;
      ctx.textAlign = "center";
      frame.strikes[0].byExpiry.forEach((e, j) => {
        const cx = tableX + j * cellW;
        if (cx > dims.w) return;
        ctx.fillText(e.expiryDate, cx + cellW / 2, 8);
      });
    }
  }, [rows, dims, viewMode, agg, settings, spot, strikeStep, chartAreaWidth, cellW, frame, maxAbs, maxCellAbs, metricDef, nExpCols]);

  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const idx = Math.floor(y / rowH);
    const row = rows[idx];
    if (!row) return;
    setPopover({ strike: row.strike, x, y, row });
  };

  const handleCanvasMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const idx = Math.floor(y / rowH);
    const row = rows[idx];
    if (row && row.strike !== hoverRow) {
      setHoverRow(row.strike);
      onCrossPanelHover && onCrossPanelHover(row.strike);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", flexWrap: "wrap", borderBottom: `1px solid ${C.divider}`, background: C.bgInset }}>
        <Segmented options={["Chart", "Table"]} value={viewMode} onChange={setViewMode} />
        <Dropdown value={metric} options={METRICS.map((m) => m.id)} onChange={setMetric} />
        <Segmented options={["Net", "Call/Put"]} value={agg} onChange={setAgg} />
        <Chip label={scope} active={scope === "0DTE only"} onClick={() => setScope((s) => (s === "0DTE only" ? "All expiries" : "0DTE only"))} title="Toggle expiry scope" />
        <Dropdown value={participant} options={PARTICIPANTS} onChange={setParticipant} />
        <Chip label="Σ ODTE" active={cumulative} onClick={() => setCumulative((c) => !c)} title="Cumulative sum across expiries" />
        <span style={{ color: C.textFaint, fontSize: 9.5, fontFamily: C.fontMono, marginLeft: "auto" }}>{expiries.length} EXP</span>
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto" }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick} onMouseMove={handleCanvasMove} style={{ display: "block", cursor: "pointer" }} />
        {popover && <StrikeInsightPopover popover={popover} metricDef={metricDef} precision={settings.precision} onClose={() => setPopover(null)} />}
      </div>
    </div>
  );
}

/** Builds this panel's ConfigDrawer sections (Milestone 6). */
export function buildPanel1ConfigSections(settings, setSettings) {
  return [
    {
      id: "display",
      title: "Display",
      defaultOpen: true,
      render: () => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim, marginBottom: 4, fontSize: 11 }}>
              <span>Bar opacity</span>
              <span>{settings.opacity.toFixed(2)}</span>
            </div>
            <input type="range" min={0.2} max={1} step={0.05} value={settings.opacity} onChange={(e) => setSettings((s) => ({ ...s, opacity: Number(e.target.value) }))} style={{ width: "100%" }} />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim, marginBottom: 4, fontSize: 11 }}>
              <span>Decimal precision</span>
              <span>{settings.precision}</span>
            </div>
            <input type="range" min={0} max={3} step={1} value={settings.precision} onChange={(e) => setSettings((s) => ({ ...s, precision: Number(e.target.value) }))} style={{ width: "100%" }} />
          </div>
          <div>
            <div style={{ color: C.textDim, marginBottom: 4, fontSize: 11 }}>Color intensity scale</div>
            <Segmented options={["linear", "log"]} value={settings.scale} onChange={(v) => setSettings((s) => ({ ...s, scale: v }))} />
          </div>
        </div>
      ),
    },
  ];
}
