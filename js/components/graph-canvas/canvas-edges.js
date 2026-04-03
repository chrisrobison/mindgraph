import { clamp, formatEdgeLabel, NODE_SIZE_BY_TYPE } from "../../core/constants.js";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const edgeAnchor = (node, otherNode) => {
  const size = NODE_SIZE_BY_TYPE[node.type] ?? NODE_SIZE_BY_TYPE.note;
  const nx = node.position?.x ?? 0;
  const ny = node.position?.y ?? 0;
  const cx = nx + size.width / 2;
  const cy = ny + size.height / 2;

  const otherSize = NODE_SIZE_BY_TYPE[otherNode.type] ?? NODE_SIZE_BY_TYPE.note;
  const ox = (otherNode.position?.x ?? 0) + otherSize.width / 2;
  const oy = (otherNode.position?.y ?? 0) + otherSize.height / 2;

  const dx = ox - cx;
  const dy = oy - cy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { x: nx + size.width, y: cy } : { x: nx, y: cy };
  }

  return dy >= 0 ? { x: cx, y: ny + size.height } : { x: cx, y: ny };
};

const buildCurve = (sourcePoint, targetPoint) => {
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    const control = clamp(Math.abs(dx) * 0.35, 40, 200);
    const c1 = { x: sourcePoint.x + Math.sign(dx || 1) * control, y: sourcePoint.y };
    const c2 = { x: targetPoint.x - Math.sign(dx || 1) * control, y: targetPoint.y };
    return {
      path: `M ${sourcePoint.x} ${sourcePoint.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${targetPoint.x} ${targetPoint.y}`,
      source: sourcePoint,
      c1,
      c2,
      target: targetPoint
    };
  }

  const control = clamp(Math.abs(dy) * 0.35, 40, 200);
  const c1 = { x: sourcePoint.x, y: sourcePoint.y + Math.sign(dy || 1) * control };
  const c2 = { x: targetPoint.x, y: targetPoint.y - Math.sign(dy || 1) * control };
  return {
    path: `M ${sourcePoint.x} ${sourcePoint.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${targetPoint.x} ${targetPoint.y}`,
    source: sourcePoint,
    c1,
    c2,
    target: targetPoint
  };
};

const bezierPoint = (curve, t) => {
  const p0 = curve.source;
  const p1 = curve.c1;
  const p2 = curve.c2;
  const p3 = curve.target;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  };
};

export const renderEdgesSvg = (edgeLayerEl, nodes = [], edges = [], selectedEdgeId = null) => {
  if (!edgeLayerEl) return;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const defs = `
    <defs>
      <marker id="mg-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" class="graph-edge-arrow"></path>
      </marker>
    </defs>
  `;

  const edgeMarkup = edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return "";

      const sourcePoint = edgeAnchor(source, target);
      const targetPoint = edgeAnchor(target, source);
      const curve = buildCurve(sourcePoint, targetPoint);
      const rawLabel = String(edge.label ?? "").trim();
      const labelValue = rawLabel || formatEdgeLabel(edge.type || "");
      const label = escapeHtml(labelValue);
      const mid = bezierPoint(curve, 0.5);
      const labelWidth = clamp(labelValue.length * 6.2 + 18, 44, 170);

      return `
        <path class="graph-edge-hit-area" data-edge-id="${edge.id}" d="${curve.path}"></path>
        <path class="graph-edge-path graph-edge-${edge.type} ${edge.id === selectedEdgeId ? "is-selected" : ""}" data-edge-visual-id="${edge.id}" d="${curve.path}" marker-end="url(#mg-arrow)"></path>
        <g class="graph-edge-label-group" transform="translate(${mid.x}, ${mid.y - 8})">
          <rect class="graph-edge-label-bg" x="${-labelWidth / 2}" y="-9" width="${labelWidth}" height="18" rx="9" ry="9"></rect>
          <text class="graph-edge-label" x="0" y="4">${label}</text>
        </g>
      `;
    })
    .join("");

  edgeLayerEl.innerHTML = `${defs}${edgeMarkup}<path class="graph-edge-draft" data-role="edge-draft" hidden></path>`;
};
