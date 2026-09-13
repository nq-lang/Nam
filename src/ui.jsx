import { useEffect, useRef, useState } from "react";
import { C } from "./theme";
import { useSplit, useConfigDrawer } from "./hooks";
import { MODELS, AVAILABLE_SYMBOLS } from "./data";

// =====================================================================
// Shared UI primitives
// =====================================================================

export function Chip({ label, active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontSize: 10,
        fontFamily: C.fontUI,
        letterSpacing: "0.01em",
        padding: "3px 7px",
        borderRadius: C.radiusSm,
        border: `1px solid ${active ? C.focus : C.border}`,
        color: active ? C.text : C.textDim,
        background: active ? "rgba(77,143,214,0.10)" : "transparent",
        whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : "default",
        lineHeight: 1.4,
        transition: "border-color 0.1s, background 0.1s",
      }}
    >
      {label}
    </button>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: C.radiusSm, overflow: "hidden" }}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            fontSize: 10,
            fontFamily: C.fontUI,
            letterSpacing: "0.01em",
            padding: "3px 8px",
            border: "none",
            borderRight: opt !== options[options.length - 1] ? `1px solid ${C.border}` : "none",
            background: value === opt ? "rgba(77,143,214,0.16)" : "transparent",
            color: value === opt ? C.text : C.textDim,
            cursor: "pointer",
            lineHeight: 1.4,
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function Dropdown({ value, options, onChange, render }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Chip label={`${render ? render(value) : value} ▾`} active onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "120%",
            left: 0,
            background: C.bgElevated,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: C.radiusMd,
            zIndex: 20,
            minWidth: 100,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {options.map((opt) => (
            <div
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                padding: "6px 10px",
                fontSize: 10.5,
                fontFamily: C.fontUI,
                color: opt === value ? C.text : C.textDim,
                background: opt === value ? "rgba(77,143,214,0.10)" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {render ? render(opt) : opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorKeyLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 9, fontFamily: C.fontMono, color: C.textFaint }}>
      <span style={{ width: 8, height: 8, background: C.accent, display: "inline-block", borderRadius: 2 }} />
      <span>+</span>
      <span style={{ width: 8, height: 8, background: C.accentRose, display: "inline-block", borderRadius: 2 }} />
      <span>−</span>
      <span style={{ width: 10, height: 1, background: C.text, display: "inline-block" }} />
      <span>ZERO-X</span>
    </div>
  );
}

// =====================================================================
// Resizable split layout primitives
// =====================================================================

export function Splitter({ direction, onDrag, active }) {
  const draggingRef = useRef(false);
  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    onDrag(e);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };
  const isRow = direction === "row";
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        flex: "0 0 auto",
        width: isRow ? 6 : "100%",
        height: isRow ? "100%" : 6,
        cursor: isRow ? "col-resize" : "row-resize",
        background: active ? C.focus : "transparent",
        position: "relative",
        zIndex: 5,
        touchAction: "none",
      }}
    >
      <div style={{ position: "absolute", inset: 0, margin: "auto", width: isRow ? 1 : "100%", height: isRow ? "100%" : 1, background: C.border }} />
    </div>
  );
}

/** Two-pane resizable split. `direction="row"` splits left/right; `"column"` splits top/bottom. */
export function TwoWaySplit({ id, direction, initial = 0.5, min = 0.15, minPx, first, second, dragActiveId, setDragActiveId }) {
  const containerRef = useRef(null);
  const [ratio, setRatio] = useSplit(id, initial, min);

  const onDrag = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isRow = direction === "row";
    const pos = isRow ? e.clientX - rect.left : e.clientY - rect.top;
    const total = isRow ? rect.width : rect.height;
    let r = pos / total;
    if (minPx) {
      const minR = minPx / total;
      r = Math.min(1 - minR, Math.max(minR, r));
    }
    setRatio(r);
    setDragActiveId(id);
  };

  useEffect(() => {
    const up = () => setDragActiveId(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [setDragActiveId]);

  const isRow = direction === "row";
  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: isRow ? "row" : "column", width: "100%", height: "100%", minHeight: 0, minWidth: 0 }}>
      <div style={{ flex: `${ratio} 1 0`, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{first}</div>
      <Splitter direction={direction} onDrag={onDrag} active={dragActiveId === id} />
      <div style={{ flex: `${1 - ratio} 1 0`, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{second}</div>
    </div>
  );
}

/** Three-pane row split, implemented as two chained ratios. */
export function ThreeWaySplit({ id, min = 0.15, minPx, panels, dragActiveId, setDragActiveId }) {
  const containerRef = useRef(null);
  const [rA, setRA] = useSplit(id + ":a", 1 / 3, min);
  const [rB, setRB] = useSplit(id + ":b", 1 / 3, min);

  const onDragFirst = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pos = e.clientX - rect.left;
    let r = pos / rect.width;
    if (minPx) {
      const minR = minPx / rect.width;
      r = Math.min(1 - minR * 2, Math.max(minR, r));
    }
    setRA(r);
    setDragActiveId(id + ":a");
  };
  const onDragSecond = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panel1Width = rA * rect.width;
    const remaining = rect.width - panel1Width;
    const pos = e.clientX - rect.left - panel1Width;
    let r = pos / remaining;
    if (minPx) {
      const minR = minPx / remaining;
      r = Math.min(1 - minR, Math.max(minR, r));
    }
    setRB(r);
    setDragActiveId(id + ":b");
  };

  useEffect(() => {
    const up = () => setDragActiveId(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [setDragActiveId]);

  const w1 = rA;
  const wRest = 1 - rA;
  const w2 = wRest * rB;
  const w3 = wRest * (1 - rB);

  return (
    <div ref={containerRef} style={{ display: "flex", width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
      <div style={{ flex: `${w1} 1 0`, minWidth: 0, overflow: "hidden" }}>{panels[0]}</div>
      <Splitter direction="row" onDrag={onDragFirst} active={dragActiveId === id + ":a"} />
      <div style={{ flex: `${w2} 1 0`, minWidth: 0, overflow: "hidden" }}>{panels[1]}</div>
      <Splitter direction="row" onDrag={onDragSecond} active={dragActiveId === id + ":b"} />
      <div style={{ flex: `${w3} 1 0`, minWidth: 0, overflow: "hidden" }}>{panels[2]}</div>
    </div>
  );
}

// =====================================================================
// Generalized Configuration/Properties drawer (Milestone 6)
// =====================================================================

export function ConfigDrawer({ title = "Configuration", sections, openSections, onToggleSection, onExpandAll, onCollapseAll, onClose, onReset, onApply }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", background: C.bgElevated, border: `1px solid ${C.borderStrong}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, flex: "0 0 auto" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{title}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 14 }} aria-label="Close">
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, padding: "8px 14px", fontSize: 11, borderBottom: `1px solid ${C.border}` }}>
        <button onClick={onExpandAll} style={{ background: "none", border: "none", color: C.focus, cursor: "pointer", fontSize: 11, padding: 0 }}>
          Expand all
        </button>
        <span style={{ color: C.textFaint }}>|</span>
        <button onClick={onCollapseAll} style={{ background: "none", border: "none", color: C.focus, cursor: "pointer", fontSize: 11, padding: 0 }}>
          Collapse all
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 14px" }}>
        {sections.map((section) => {
          const isOpen = openSections[section.id] ?? section.defaultOpen ?? false;
          return (
            <div key={section.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 0" }}>
              <button
                onClick={() => onToggleSection(section.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0, width: "100%", textAlign: "left" }}
              >
                <span style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>›</span>
                {section.title}
              </button>
              {isOpen && <div style={{ marginTop: 10, paddingLeft: 4 }}>{section.render()}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderTop: `1px solid ${C.border}`, flex: "0 0 auto" }}>
        <button onClick={onReset} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 4, padding: "8px 0", fontSize: 12, cursor: "pointer" }}>
          Reset
        </button>
        <button onClick={onApply} style={{ flex: 1, background: C.focus, border: "none", color: "#0a1622", borderRadius: 4, padding: "8px 0", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Apply
        </button>
      </div>
    </div>
  );
}

/**
 * Shared chrome for every panel: title/subtitle/badge header plus a
 * gear button. If `configSections` is provided, the gear opens a
 * generalized ConfigDrawer built from those sections.
 */
export function PanelFrame({ title, subtitle, badge, children, configSections }) {
  const sectionIds = (configSections || []).map((s) => s.id);
  const drawer = useConfigDrawer(sectionIds);
  const hasConfig = Boolean(configSections && configSections.length);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bgPanel, border: `1px solid ${C.border}`, minWidth: 0, minHeight: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: `1px solid ${C.divider}`, background: C.bgElevated, flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: C.text, whiteSpace: "nowrap", letterSpacing: "0.03em", textTransform: "uppercase" }}>{title}</span>
          {subtitle && <span style={{ fontSize: 10.5, color: C.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
          {badge && <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textFaint, border: `1px solid ${C.border}`, borderRadius: C.radiusSm, padding: "1px 5px", letterSpacing: "0.02em" }}>{badge}</span>}
          {hasConfig && (
            <button onClick={drawer.open} title="Panel settings" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12, padding: 2, lineHeight: 1 }}>
              ⚙
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: "1 1 0", minHeight: 0, minWidth: 0, position: "relative" }}>
        {children}
        {hasConfig && drawer.isOpen && (
          <ConfigDrawer
            sections={configSections}
            openSections={drawer.openSections}
            onToggleSection={drawer.toggleSection}
            onExpandAll={drawer.expandAll}
            onCollapseAll={drawer.collapseAll}
            onClose={drawer.close}
            onReset={() => {}}
            onApply={drawer.close}
          />
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Shared master playback scrubber
// =====================================================================

const ctrlBtnStyle = { background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 11, padding: "0 2px", fontFamily: "inherit" };

export function PlaybackFooter({ frameIdx, numFrames, playing, speed, onPlayToggle, onScrub, onSpeedChange, onStep, onJump, clockLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderTop: `1px solid ${C.divider}`, background: C.bgInset, fontSize: 10, flex: "0 0 auto" }}>
      <span style={{ color: C.textDim, fontWeight: 600, letterSpacing: "0.04em", fontSize: 9.5 }}>PLAYBACK</span>
      <span style={{ color: C.textFaint, fontFamily: C.fontMono, fontSize: 9.5 }}>{numFrames} SNAPSHOTS</span>
      <div style={{ width: 1, height: 12, background: C.border }} />
      <button onClick={() => onJump("start")} style={ctrlBtnStyle}>⏮</button>
      <button onClick={() => onStep(-1)} style={ctrlBtnStyle}>◂</button>
      <button onClick={onPlayToggle} style={{ ...ctrlBtnStyle, color: C.accent }}>{playing ? "⏸" : "▶"}</button>
      <button onClick={() => onStep(1)} style={ctrlBtnStyle}>▸</button>
      <button onClick={() => onJump("end")} style={ctrlBtnStyle}>⏭</button>
      <Dropdown value={`${speed}×`} options={["1x", "2x", "4x", "8x"]} onChange={(v) => onSpeedChange(Number(v.replace("x", "")))} />
      <input type="range" min={0} max={numFrames - 1} value={frameIdx} onChange={(e) => onScrub(Number(e.target.value))} style={{ flex: 1, minWidth: 80, accentColor: C.focus }} />
      <span style={{ color: C.textFaint, fontFamily: C.fontMono, fontVariantNumeric: "tabular-nums", fontSize: 9.5 }}>{frameIdx + 1}/{numFrames}</span>
      <div style={{ width: 1, height: 12, background: C.border }} />
      <span style={{ color: C.textDim, fontFamily: C.fontMono, fontVariantNumeric: "tabular-nums", fontSize: 9.5 }}>{clockLabel}</span>
    </div>
  );
}

// =====================================================================
// Terminal toolbar
// =====================================================================

export function Toolbar({ dashboard, onBack, feedLabel = "MOCK FEED" }) {
  return (
    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px", borderBottom: `1px solid ${C.divider}`, background: C.bgElevated, fontSize: 11 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12 }}>
        ← Dashboards
      </button>
      <div style={{ width: 1, height: 16, background: C.border }} />
      <span style={{ fontWeight: 700, color: C.text, fontFamily: C.fontMono, letterSpacing: "0.02em" }}>{dashboard.symbol}</span>
      <span style={{ color: C.textDim }}>{dashboard.model}</span>
      <div style={{ width: 1, height: 16, background: C.border }} />
      <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.accent, fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: "0.03em" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, display: "inline-block" }} />
        {feedLabel}
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ color: C.textFaint, fontSize: 9.5, fontFamily: C.fontMono }}>SYNCED PLAYBACK · PANELS 1–4</span>
    </div>
  );
}

// =====================================================================
// Dashboard list (home screen)
// =====================================================================

export function DashboardList({ dashboards, onOpen, onCreate }) {
  return (
    <div style={{ padding: "32px 40px", maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: C.text, fontWeight: 700 }}>Dashboards</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.textDim }}>Exposure terminals — one per symbol/model combination.</p>
        </div>
        <button onClick={onCreate} style={{ background: C.accent, color: "#08211d", border: "none", borderRadius: 4, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + New Dashboard
        </button>
      </div>
      {dashboards.length === 0 ? (
        <div style={{ border: `1px dashed ${C.border}`, borderRadius: 6, padding: "48px 24px", textAlign: "center", color: C.textDim, fontSize: 13 }}>
          No dashboards yet. Create one to start watching exposure for a symbol.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {dashboards.map((d) => (
            <button
              key={d.id}
              onClick={() => onOpen(d)}
              style={{ textAlign: "left", background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 16, cursor: "pointer", color: C.text }}
            >
              <div style={{ fontWeight: 700, fontSize: 13.5, fontFamily: C.fontMono }}>{d.name}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, fontFamily: C.fontMono }}>
                {d.symbol} · {d.model}
              </div>
              <div style={{ fontSize: 10, color: C.textFaint, marginTop: 10 }}>Updated {d.updated}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Model picker ("+ New Dashboard" flow)
// =====================================================================

export function ModelPicker({ onCreate, onCancel }) {
  const [symbol, setSymbol] = useState(AVAILABLE_SYMBOLS[0]);
  const [model, setModel] = useState(MODELS[0].id);
  const [name, setName] = useState("");

  return (
    <div style={{ padding: "32px 40px", maxWidth: 620, margin: "0 auto" }}>
      <button onClick={onCancel} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12, marginBottom: 16 }}>
        ← Cancel
      </button>
      <h1 style={{ margin: 0, fontSize: 20, color: C.text, fontWeight: 700 }}>New Dashboard</h1>
      <p style={{ fontSize: 12.5, color: C.textDim, marginTop: 4 }}>Choose a symbol and an analytics model.</p>

      <div style={{ marginTop: 24 }}>
        <label style={{ fontSize: 11.5, color: C.textDim, display: "block", marginBottom: 6 }}>Dashboard name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${symbol} ${MODELS.find((m) => m.id === model)?.name}`}
          style={{ width: "100%", background: C.bgPanel, border: `1px solid ${C.border}`, color: C.text, padding: "9px 10px", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ fontSize: 11.5, color: C.textDim, display: "block", marginBottom: 6 }}>Symbol</label>
        <div style={{ display: "flex", gap: 8 }}>
          {AVAILABLE_SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              style={{ padding: "7px 14px", borderRadius: 4, border: `1px solid ${s === symbol ? C.focus : C.border}`, background: s === symbol ? "rgba(77,143,214,0.12)" : C.bgPanel, color: C.text, cursor: "pointer", fontSize: 12.5 }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ fontSize: 11.5, color: C.textDim, display: "block", marginBottom: 6 }}>Model</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              style={{ textAlign: "left", padding: "11px 14px", borderRadius: 4, border: `1px solid ${m.id === model ? C.focus : C.border}`, background: m.id === model ? "rgba(77,143,214,0.08)" : C.bgPanel, color: C.text, cursor: "pointer" }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() =>
          onCreate({
            id: "d" + Date.now(),
            name: name || `${symbol} ${MODELS.find((m) => m.id === model)?.name}`,
            symbol,
            modelId: model,
            model: MODELS.find((m) => m.id === model)?.name,
            updated: "just now",
          })
        }
        style={{ marginTop: 24, width: "100%", background: C.accent, color: "#08211d", border: "none", borderRadius: 4, padding: "11px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
      >
        Create dashboard
      </button>
    </div>
  );
}
