import { useCallback, useState } from "react";
import { loadSplitRatio, saveSplitRatio } from "./data";

/**
 * A single persisted split ratio (0-1), clamped to [min, 1-min].
 * Backed by localStorage so panel proportions survive reloads and
 * navigation away from the terminal screen.
 */
export function useSplit(id, initial, min = 0.12) {
  const [ratio, setRatio] = useState(() => loadSplitRatio(id, initial));
  const update = useCallback(
    (r) => {
      const clamped = Math.min(1 - min, Math.max(min, r));
      saveSplitRatio(id, clamped);
      setRatio(clamped);
    },
    [id, min]
  );
  return [ratio, update];
}

/**
 * Drives the open/closed state of a panel's ConfigDrawer plus which
 * sections are expanded. Panel-agnostic: any panel type can call this
 * and pass its own `sections` array (see ConfigDrawer in ui.js) without
 * this hook knowing what those sections contain.
 */
export function useConfigDrawer(sectionIds = []) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState(() => Object.fromEntries(sectionIds.map((id) => [id, false])));

  const toggleSection = (id) => setOpenSections((s) => ({ ...s, [id]: !s[id] }));
  const expandAll = () => setOpenSections(Object.fromEntries(sectionIds.map((id) => [id, true])));
  const collapseAll = () => setOpenSections(Object.fromEntries(sectionIds.map((id) => [id, false])));

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    openSections,
    toggleSection,
    expandAll,
    collapseAll,
  };
}
