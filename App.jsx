import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { C } from "./theme";
import { DashboardList, ModelPicker, Toolbar, TwoWaySplit, ThreeWaySplit, PanelFrame, PlaybackFooter } from "./ui";
import { Panel1Chart, buildPanel1ConfigSections } from "./panels/Panel1Exposure";
import { GreekSurfacePanel, IVGrid } from "./panels/PanelGreekAndIV";
import { Panel5Surface3D } from "./panels/Panel3DSurface";
import { makeMockSnapshotSeries, MOCK_SPOT_BY_SYMBOL, loadDashboards, saveDashboards, getModelById } from "./data";

// =====================================================================
// Terminal screen: builds its panel grid dynamically from the dashboard's
// selected model (data.js `panels`/`greeks` fields), rather than always
// showing all five panels. A shared master playback clock drives every
// panel that reads from the snapshot series (all but the 3D surface,
// which is intentionally not scrubber-synced yet — spec §8.3).
//
// Layouts by panel count:
//  - 5 panels (exposure + both Greek surfaces + IV grid + 3D surface):
//    3-over-2 grid, as in the original spec.
//  - 2 panels (either the two Greek surfaces, or IV grid + 3D surface):
//    single side-by-side split filling the whole screen.
//
// Data sourcing: swap `makeMockSnapshotSeries` for `fetchSnapshotSeries`
// from data.js once IBKR access is available (Milestone 7) — every
// panel below consumes only the normalized SnapshotSeries shape and
// needs no changes.
// =====================================================================

function Terminal({ dashboard, onBack }) {
  const model = useMemo(() => getModelById(dashboard.modelId), [dashboard.modelId]);

  const series = useMemo(() => makeMockSnapshotSeries(dashboard.symbol, MOCK_SPOT_BY_SYMBOL[dashboard.symbol] || 500), [dashboard.symbol]);

  const [frameIdx, setFrameIdx] = useState(series.frames.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dragActiveId, setDragActiveId] = useState(null);
  const [hoveredStrike, setHoveredStrike] = useState(null); // §8.4 cross-panel strike hover
  const [panel1Settings, setPanel1Settings] = useState({ opacity: 0.85, precision: 1, scale: "linear" });
  const rafRef = useRef(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const interval = 200 / speed;
    const tick = (t) => {
      if (t - last > interval) {
        last = t;
        setFrameIdx((i) => (i + 1) % series.frames.length);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, series.frames.length]);

  const frame = series.frames[frameIdx];
  const clockLabel = useMemo(() => {
    const d = new Date(frame.timestamp);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + " ET";
  }, [frame.timestamp]);

  const step = (dir) => setFrameIdx((i) => Math.min(series.frames.length - 1, Math.max(0, i + dir)));
  const jump = (where) => setFrameIdx(where === "start" ? 0 : series.frames.length - 1);

  const panel1ConfigSections = useMemo(() => buildPanel1ConfigSections(panel1Settings, setPanel1Settings), [panel1Settings]);

  // The master playback footer rides along with whichever panel is first
  // in this model's panel list, rather than being hardcoded to "Panel 1" -
  // some models (e.g. Vanna/Charm Desk) don't include the exposure panel
  // at all, but every model still needs exactly one scrubber.
  const footer = (
    <PlaybackFooter
      frameIdx={frameIdx}
      numFrames={series.frames.length}
      playing={playing}
      speed={speed}
      onPlayToggle={() => setPlaying((p) => !p)}
      onScrub={setFrameIdx}
      onSpeedChange={setSpeed}
      onStep={step}
      onJump={jump}
      clockLabel={clockLabel}
    />
  );

  function withFooterIfFirst(content, isFirst) {
    if (!isFirst) return content;
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>{content}</div>
        {footer}
      </div>
    );
  }

  const panelBuilders = {
    exposure: (isFirst) => (
      <PanelFrame key="exposure" title="Panel · Exposure" subtitle="Strike Exposure" badge="2D canvas" configSections={panel1ConfigSections}>
        {withFooterIfFirst(
          <Panel1Chart frame={frame} expiries={series.expiries} onCrossPanelHover={setHoveredStrike} hoveredStrike={hoveredStrike} settings={panel1Settings} setSettings={setPanel1Settings} />,
          isFirst
        )}
      </PanelFrame>
    ),
    greekA: (isFirst) => (
      <PanelFrame key="greekA" title="Panel · Greek A" subtitle={`${model.greeks[0] || "Gamma"} Surface`} badge="interpolated">
        {withFooterIfFirst(
          <GreekSurfacePanel allFrames={series.frames} frameIdx={frameIdx} hoveredStrike={hoveredStrike} onCrossPanelHover={setHoveredStrike} defaultGreek={model.greeks[0] || "Gamma"} />,
          isFirst
        )}
      </PanelFrame>
    ),
    greekB: (isFirst) => (
      <PanelFrame key="greekB" title="Panel · Greek B" subtitle={`${model.greeks[1] || "Vanna"} Surface`} badge="interpolated">
        {withFooterIfFirst(
          <GreekSurfacePanel allFrames={series.frames} frameIdx={frameIdx} hoveredStrike={hoveredStrike} onCrossPanelHover={setHoveredStrike} defaultGreek={model.greeks[1] || "Vanna"} />,
          isFirst
        )}
      </PanelFrame>
    ),
    ivGrid: (isFirst) => (
      <PanelFrame key="ivGrid" title="Panel · IV Grid" subtitle="Fixed-Strike IV Grid" badge="2D grid">
        {withFooterIfFirst(<IVGrid frame={frame} hoveredStrike={hoveredStrike} onCrossPanelHover={setHoveredStrike} playbackSpeed={speed} />, isFirst)}
      </PanelFrame>
    ),
    surface3d: (isFirst) => (
      <PanelFrame key="surface3d" title="Panel · 3D Surface" subtitle="3D IV Surface" badge="three.js">
        {withFooterIfFirst(<Panel5Surface3D frame={frame} />, isFirst)}
      </PanelFrame>
    ),
  };

  const activePanelTypes = model.panels.length ? model.panels : ["exposure", "greekA", "greekB", "ivGrid", "surface3d"];
  const panels = activePanelTypes.map((type, i) => panelBuilders[type](i === 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Toolbar dashboard={dashboard} onBack={onBack} />
      <div style={{ flex: 1, minHeight: 0 }}>{renderGrid(panels, dragActiveId, setDragActiveId)}</div>
    </div>
  );
}

/**
 * Lays panels out based on how many the current model needs. Only the
 * counts actually produced by data.js are handled explicitly (5 or 2);
 * any other count falls back to an even horizontal split so a future
 * model with a different panel count still renders sensibly instead of
 * crashing.
 */
function renderGrid(panels, dragActiveId, setDragActiveId) {
  if (panels.length === 5) {
    return (
      <TwoWaySplit
        id="root-rowsplit"
        direction="column"
        initial={0.58}
        minPx={140}
        dragActiveId={dragActiveId}
        setDragActiveId={setDragActiveId}
        first={<ThreeWaySplit id="top-row" minPx={220} panels={[panels[0], panels[1], panels[2]]} dragActiveId={dragActiveId} setDragActiveId={setDragActiveId} />}
        second={
          <TwoWaySplit id="bottom-row" direction="row" initial={0.5} minPx={220} dragActiveId={dragActiveId} setDragActiveId={setDragActiveId} first={panels[3]} second={panels[4]} />
        }
      />
    );
  }

  if (panels.length === 2) {
    return (
      <TwoWaySplit id="two-panel-row" direction="row" initial={0.5} minPx={260} dragActiveId={dragActiveId} setDragActiveId={setDragActiveId} first={panels[0]} second={panels[1]} />
    );
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {panels.map((p, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0 }}>
          {p}
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// App root: routes between dashboard list, model picker, and terminal.
// =====================================================================

function App() {
  const [dashboards, setDashboards] = useState(loadDashboards);
  const [view, setView] = useState({ screen: "list" }); // list | picker | terminal

  const openDashboard = (d) => setView({ screen: "terminal", dashboard: d });

  const createDashboard = (d) => {
    const next = [...dashboards, d];
    setDashboards(next);
    saveDashboards(next);
    setView({ screen: "terminal", dashboard: d });
  };

  return (
    <div style={{ width: "100%", height: "100vh", background: C.bg, color: C.text, fontFamily: C.fontUI, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {view.screen === "list" && (
        <div style={{ overflow: "auto", height: "100%" }}>
          <DashboardList dashboards={dashboards} onOpen={openDashboard} onCreate={() => setView({ screen: "picker" })} />
        </div>
      )}
      {view.screen === "picker" && (
        <div style={{ overflow: "auto", height: "100%" }}>
          <ModelPicker onCreate={createDashboard} onCancel={() => setView({ screen: "list" })} />
        </div>
      )}
      {view.screen === "terminal" && <Terminal dashboard={view.dashboard} onBack={() => setView({ screen: "list" })} />}
    </div>
  );
}

// =====================================================================
// React bootstrap (merged from main.jsx)
// =====================================================================

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
