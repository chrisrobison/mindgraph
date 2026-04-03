/* ── Legacy canvas-selection stub ── */
/* Selection is now handled by Three.js raycasting in graph-canvas.js */

export const normalizeScreenRect = (startX, startY, endX, endY) => ({
	left: Math.min(startX, endX),
	top: Math.min(startY, endY),
	width: Math.abs(endX - startX),
	height: Math.abs(endY - startY),
	right: Math.max(startX, endX),
	bottom: Math.max(startY, endY),
});

export const findNodeIdsInWorldRect = () => [];
