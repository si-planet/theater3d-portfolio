const finite = Number.isFinite;

function inRect(rect, x, y) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(finite)
    && rect.width > 0 && rect.height > 0
    && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function onSegment(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y, scale = Math.max(1, Math.hypot(dx, dy));
  return Math.abs((x - a.x) * dy - (y - a.y) * dx) <= 1e-7 * scale
    && x >= Math.min(a.x, b.x) - 1e-7 && x <= Math.max(a.x, b.x) + 1e-7
    && y >= Math.min(a.y, b.y) - 1e-7 && y <= Math.max(a.y, b.y) + 1e-7;
}

function inPolygon(polygon, x, y) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(point => !point || !finite(point.x) || !finite(point.y))) return false;
  const area = polygon.reduce((sum, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(area) < 1e-7) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(a, b, x, y)) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function surfaceDepth(surface, x, y) {
  if (!surface || !finite(surface.depth) || surface.depth <= 0 || surface.visible === false) return Infinity;
  if (surface.bounds && !inRect(surface.bounds, x, y)) return Infinity;
  if (surface.type === 'polygon') return inPolygon(surface.polygon, x, y) ? surface.depth : Infinity;
  if (surface.type === 'circle' && [surface.x, surface.y, surface.radius].every(finite) && surface.radius > 0) {
    return Math.hypot(x - surface.x, y - surface.y) <= surface.radius ? surface.depth : Infinity;
  }
  return Infinity;
}

/**
 * Pick an audience mesh at canvas-local CSS pixels. The renderer's live hit
 * array includes a shared `occluders` list for chairs, walls and other objects.
 * Matching surface depth decides overlaps, not a person's entire bounding box.
 * Depth is the same average used by the Canvas painter, so intersecting meshes
 * retain that renderer's approximation rather than an exact 3D depth buffer.
 */
export function pickAudience(hits, x, y) {
  if (!Array.isArray(hits) || !finite(x) || !finite(y)) return null;
  let selected = null, selectedDepth = Infinity;
  for (const hit of hits) {
    if (!hit || hit.id === undefined || hit.id === null || hit.visible !== true || !finite(hit.depth) || hit.depth <= 0) continue;
    if (hit.screen && !inRect(hit.screen, x, y)) continue;
    if (hit.bounds && !inRect(hit.bounds, x, y)) continue;
    for (const surface of Array.isArray(hit.surfaces) ? hit.surfaces : []) {
      const depth = surfaceDepth(surface, x, y);
      // Keep the original hit order when depths tie, for stable selection.
      if (depth < selectedDepth) { selected = hit; selectedDepth = depth; }
    }
  }
  if (!selected) return null;
  for (const surface of Array.isArray(hits.occluders) ? hits.occluders : []) {
    if (surfaceDepth(surface, x, y) < selectedDepth) return null;
  }
  return selected;
}
