/* ── Legacy canvas-viewport stub ── */
/* All viewport handling is now managed by Three.js OrbitControls */
/* These exports are kept for API compatibility but are no-ops */

export const applyViewportTransform = () => {};
export const screenToWorld = (_el, _vp, x, y) => ({ x, y });
export const zoomAtClientPoint = (_el, viewport) => viewport;
