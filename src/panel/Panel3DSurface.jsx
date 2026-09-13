import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { C } from "../theme";
import { Segmented, Chip, ColorKeyLegend } from "../ui";

function ivToColor3(iv, min, max) {
  const t = max > min ? (iv - min) / (max - min) : 0.5;
  const r = 63 + t * (226 - 63);
  const g = 214 + t * (89 - 214);
  const b = 155 + t * (107 - 155);
  return new THREE.Color(r / 255, g / 255, b / 255);
}

/**
 * Manual orbit controls: click-drag rotate, scroll zoom. Camera state
 * lives in a ref owned by the parent panel (not component state) so it
 * survives data-driven re-renders without resetting the viewing angle
 * (spec §7). Implemented from scratch instead of @react-three/drei,
 * which isn't part of this project's dependency set.
 */
function ManualOrbitControls({ cameraStateRef }) {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const dom = gl.domElement;
    const onDown = (e) => {
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (dragging.current = false);
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      cameraStateRef.current.theta -= dx * 0.006;
      cameraStateRef.current.phi = Math.max(0.15, Math.min(Math.PI - 0.15, cameraStateRef.current.phi - dy * 0.006));
    };
    const onWheel = (e) => {
      e.preventDefault();
      cameraStateRef.current.radius = Math.max(3, Math.min(30, cameraStateRef.current.radius * (1 + e.deltaY * 0.001)));
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      dom.removeEventListener("wheel", onWheel);
    };
  }, [gl, cameraStateRef]);

  useFrame(() => {
    const { theta, phi, radius } = cameraStateRef.current;
    camera.position.set(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/**
 * Parametric IV surface mesh: X = DTE, Z = strike (or log-moneyness),
 * Y = IV height. Vertex colors reuse the same green->red mapping as
 * the IV grid (PanelGreekAndIV.jsx) so the two panels read consistently.
 * Sparse cells (no listed contract) get their IV interpolated for the
 * mesh surface but are excluded from the point-cloud "real data" markers.
 */
function IVSurfaceMesh({ frame, moneynessMode, showOverlay, colorDomain, onHoverVertex }) {
  const meshRef = useRef(null);
  const { camera, gl, raycaster, mouse } = useThree();

  const { geometry, wireGeometry, pointsGeom, vertexMeta } = useMemo(() => {
    const strikes = frame.strikes.slice().sort((a, b) => a.strike - b.strike);
    const nS = strikes.length;
    const nE = strikes[0]?.byExpiry.length ?? 0;
    const spot = frame.underlyingPrice;

    const xs = strikes[0].byExpiry.map((e) => e.dte);
    const maxDte = Math.max(...xs, 1);
    const strikeMin = strikes[0].strike;
    const strikeMax = strikes[nS - 1].strike;

    const positions = [];
    const colors = [];
    const meta = [];

    for (let si = 0; si < nS; si++) {
      for (let ei = 0; ei < nE; ei++) {
        const cell = strikes[si].byExpiry[ei];
        const iv = cell.iv ?? colorDomain.min;
        const x = (cell.dte / maxDte) * 10 - 5;
        let yRaw;
        if (moneynessMode === "log-moneyness") {
          yRaw = Math.log(strikes[si].strike / spot);
        } else {
          yRaw = (strikes[si].strike - strikeMin) / (strikeMax - strikeMin) - 0.5;
        }
        const y = yRaw * 8;
        const z = ((iv - colorDomain.min) / (colorDomain.max - colorDomain.min || 1)) * 5;
        positions.push(x, z, y);
        const c = ivToColor3(iv, colorDomain.min, colorDomain.max);
        colors.push(c.r, c.g, c.b);
        meta.push({ strike: strikes[si].strike, dte: cell.dte, expiryLabel: cell.expiryDate, iv: cell.iv });
      }
    }

    const geo = new THREE.BufferGeometry();
    const indices = [];
    for (let si = 0; si < nS - 1; si++) {
      for (let ei = 0; ei < nE - 1; ei++) {
        const a = si * nE + ei;
        const b = si * nE + ei + 1;
        const c = (si + 1) * nE + ei;
        const d = (si + 1) * nE + ei + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const wireGeo = new THREE.WireframeGeometry(geo);

    const pointsPositions = [];
    for (let si = 0; si < nS; si++) {
      for (let ei = 0; ei < nE; ei++) {
        const cell = strikes[si].byExpiry[ei];
        if (cell.iv != null) {
          const idx = (si * nE + ei) * 3;
          pointsPositions.push(positions[idx], positions[idx + 1], positions[idx + 2]);
        }
      }
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.Float32BufferAttribute(pointsPositions, 3));

    return { geometry: geo, wireGeometry: wireGeo, pointsGeom: pointsGeo, vertexMeta: meta };
  }, [frame, moneynessMode, colorDomain]);

  const handlePointerMove = (e) => {
    if (!meshRef.current) return;
    const rect = gl.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(meshRef.current);
    if (hits.length > 0) {
      const m = vertexMeta[hits[0].face.a];
      if (m) onHoverVertex(m);
    } else {
      onHoverVertex(null);
    }
  };

  return (
    <group onPointerMove={handlePointerMove} onPointerLeave={() => onHoverVertex(null)}>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.05} />
      </mesh>
      {showOverlay && (
        <>
          <lineSegments geometry={wireGeometry}>
            <lineBasicMaterial color={C.textFaint} transparent opacity={0.35} />
          </lineSegments>
          <points geometry={pointsGeom}>
            <pointsMaterial color={C.text} size={0.06} />
          </points>
        </>
      )}
    </group>
  );
}

/**
 * Panel 5 — 3D Implied Volatility Surface (spec §7). Parametric mesh
 * with orbit/zoom, strike/log-moneyness axis toggle, wireframe +
 * point-cloud overlay marking real vs interpolated data, a live
 * crosshair tooltip, and a camera that persists across data ticks.
 */
export function Panel5Surface3D({ frame }) {
  const [moneynessMode, setMoneynessMode] = useState("strike");
  const [showOverlay, setShowOverlay] = useState(true);
  const [hoverVertex, setHoverVertex] = useState(null);
  const cameraStateRef = useRef({ theta: 0.7, phi: 1.0, radius: 14 });
  const [resetTick, setResetTick] = useState(0);

  const colorDomain = useMemo(() => {
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
    return { min, max };
  }, [frame]);

  const resetCamera = () => {
    cameraStateRef.current = { theta: 0.7, phi: 1.0, radius: 14 };
    setResetTick((t) => t + 1);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <Segmented options={["strike", "log-moneyness"]} value={moneynessMode} onChange={setMoneynessMode} />
        <Chip label={showOverlay ? "Hide markers" : "Show markers"} active={showOverlay} onClick={() => setShowOverlay((s) => !s)} />
        <button
          onClick={resetCamera}
          style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, cursor: "pointer", fontFamily: "inherit" }}
        >
          ⟲ Reset camera
        </button>
        <ColorKeyLegend />
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Canvas key={resetTick} camera={{ position: [8, 10, 8], fov: 45 }} style={{ background: "transparent" }} gl={{ alpha: true, antialias: true }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[5, 8, 5]} intensity={0.6} />
          <IVSurfaceMesh frame={frame} moneynessMode={moneynessMode} showOverlay={showOverlay} colorDomain={colorDomain} onHoverVertex={setHoverVertex} />
          <ManualOrbitControls cameraStateRef={cameraStateRef} />
        </Canvas>

        {hoverVertex && (
          <div style={{ position: "absolute", left: 10, bottom: 10, background: C.bgElevated, border: `1px solid ${C.borderStrong}`, borderRadius: 4, padding: "6px 9px", fontSize: 10.5, color: C.text, pointerEvents: "none" }}>
            <div style={{ fontWeight: 700 }}>
              Strike {hoverVertex.strike} · {hoverVertex.expiryLabel}
            </div>
            <div style={{ color: C.textDim }}>
              IV: <span style={{ color: C.text }}>{hoverVertex.iv != null ? (hoverVertex.iv * 100).toFixed(2) + "%" : "interpolated"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
