import { validateAuthoredOutline } from './authored-geometry.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const point = value => value && finite(value.x) && finite(value.z);
const validProjection = value => value && finite(value.x) && finite(value.z) && finite(value.scale) && value.scale > 0
  && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0;

/** All canvas geometry uses the same frozen projection while a pointer drags. */
export function outlineCanvasPoint(value, projection) {
  if (!point(value) || !validProjection(projection)) return null;
  return { x: projection.width / 2 + (value.x - projection.x) * projection.scale,
    y: projection.height / 2 + (value.z - projection.z) * projection.scale };
}

export function outlineWorldPoint(value, projection) {
  if (!value || !finite(value.x) || !finite(value.y) || !validProjection(projection)) return null;
  return { x: projection.x + (value.x - projection.width / 2) / projection.scale,
    z: projection.z + (value.y - projection.height / 2) / projection.scale };
}

/** Pick in CSS pixels, then retain the segment parameter in source metres.
 * The final edge is the closed edge from the last vertex back to the first. */
export function findOutlineInsertionTarget(points, pointer, projection, options = {}) {
  if (!Array.isArray(points) || points.length < 3 || !points.every(point) || !validProjection(projection)
      || !pointer || !finite(pointer.x) || !finite(pointer.y)) return { kind: 'empty' };
  const cssWidth = options.cssWidth ?? projection.width, cssHeight = options.cssHeight ?? projection.height;
  const edgeTolerance = options.edgeTolerancePx ?? 14, vertexTolerance = options.vertexTolerancePx ?? 8;
  if (![cssWidth, cssHeight, edgeTolerance, vertexTolerance].every(finite) || cssWidth <= 0 || cssHeight <= 0
      || edgeTolerance < 0 || vertexTolerance < 0) return { kind: 'empty' };
  const sx = cssWidth / projection.width, sy = cssHeight / projection.height;
  const vertices = points.map(p => { const v = outlineCanvasPoint(p, projection); return { x: v.x * sx, y: v.y * sy }; });
  const p = { x: pointer.x * sx, y: pointer.y * sy };
  let vertex = null;
  for (let index = 0; index < vertices.length; index++) {
    const distancePx = Math.hypot(vertices[index].x - p.x, vertices[index].y - p.y);
    if (distancePx <= vertexTolerance && (!vertex || distancePx < vertex.distancePx)) vertex = { kind: 'vertex', index, distancePx };
  }
  if (vertex) return vertex;
  let edge = null;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    const distancePx = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
    if (distancePx <= edgeTolerance && (!edge || distancePx < edge.distancePx)) {
      const wa = points[index], wb = points[(index + 1) % points.length];
      edge = { kind: 'edge', edgeIndex: index, t, distancePx,
        point: { x: wa.x + (wb.x - wa.x) * t, z: wa.z + (wb.z - wa.z) * t } };
    }
  }
  return edge || { kind: 'empty' };
}

/** Pure insertion never mutates the caller or infers a midpoint. */
export function insertOutlineVertex(points, { edgeIndex, t } = {}) {
  const valid = validateAuthoredOutline(points);
  if (!valid.valid) return { valid: false, error: valid.error };
  if (points.length >= 32) return { valid: false, error: '꼭짓점은 최대 32개까지 설정할 수 있습니다.' };
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= points.length || !finite(t) || t <= 0 || t >= 1)
    return { valid: false, error: '기존 꼭짓점 사이의 테두리 위치를 선택하세요.' };
  const a = points[edgeIndex], b = points[(edgeIndex + 1) % points.length];
  const inserted = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  const value = points.map(p => ({ ...p })), selectedIndex = edgeIndex + 1;
  value.splice(selectedIndex, 0, inserted);
  const checked = validateAuthoredOutline(value);
  return checked.valid ? { valid: true, points: checked.value, selectedIndex } : { valid: false, error: checked.error };
}
