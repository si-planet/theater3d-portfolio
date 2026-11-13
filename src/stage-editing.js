// Canvas-local CSS pixels share the renderer's projection; device pixels are
// deliberately absent from this module. Invalid rays leave the current edit intact.
const NEAR = 0.08;
const EPSILON = 1e-7;
const WORLD_LIMIT = 1000;
const finite = Number.isFinite;
const record = value => value !== null && typeof value === 'object';
const point3 = value => record(value) && ['x', 'y', 'z'].every(axis => finite(value[axis]));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function validRect(rect) {
  return record(rect) && [rect.x, rect.y, rect.width, rect.height].every(finite)
    && rect.width > 0 && rect.height > 0;
}

function inRect(rect, x, y) {
  return validRect(rect) && x >= rect.x && x <= rect.x + rect.width
    && y >= rect.y && y <= rect.y + rect.height;
}

function onSegment(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs((x - a.x) * dy - (y - a.y) * dx) <= EPSILON * Math.max(1, Math.hypot(dx, dy))
    && x >= Math.min(a.x, b.x) - EPSILON && x <= Math.max(a.x, b.x) + EPSILON
    && y >= Math.min(a.y, b.y) - EPSILON && y <= Math.max(a.y, b.y) + EPSILON;
}

function inPolygon(polygon, x, y) {
  if (!Array.isArray(polygon) || polygon.length < 3
      || polygon.some(point => !record(point) || !finite(point.x) || !finite(point.y))) return false;
  const area = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (!finite(area) || Math.abs(area) < EPSILON) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous], b = polygon[index];
    if (onSegment(a, b, x, y)) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function containsSurface(surface, x, y) {
  if (!record(surface) || !finite(surface.depth) || surface.depth <= 0 || surface.visible === false) return false;
  if (surface.bounds && !inRect(surface.bounds, x, y)) return false;
  if (surface.type === 'polygon') return inPolygon(surface.polygon, x, y);
  return surface.type === 'circle' && [surface.x, surface.y, surface.radius].every(finite)
    && surface.radius > 0 && Math.hypot(x - surface.x, y - surface.y) <= surface.radius;
}

function inFront(surface, other) {
  if (!other) return true;
  if (surface.depth !== other.depth) return surface.depth < other.depth;
  return (finite(surface.drawOrder) ? surface.drawOrder : -Infinity)
    > (finite(other.drawOrder) ? other.drawOrder : -Infinity);
}

/**
 * Pick the actual drawn person/structure surface, respecting the Canvas painter's
 * depth and draw-order approximation. Bounding rectangles alone never select.
 * Shared noneditable surfaces are supplied on stageObjectHits.occluders.
 */
export function pickStageObject(hits, x, y) {
  if (!Array.isArray(hits) || !finite(x) || !finite(y)) return null;
  let selected = null, frontSurface = null;
  for (const hit of hits) {
    if (!record(hit) || hit.id === null || hit.id === undefined
        || !['person', 'structure'].includes(hit.kind) || hit.visible !== true
        || !finite(hit.depth) || hit.depth <= 0) continue;
    if (hit.screen && !inRect(hit.screen, x, y)) continue;
    if (hit.bounds && !inRect(hit.bounds, x, y)) continue;
    for (const surface of Array.isArray(hit.surfaces) ? hit.surfaces : []) {
      if (containsSurface(surface, x, y) && inFront(surface, frontSurface)) {
        selected = hit; frontSurface = surface;
      }
    }
  }
  if (!selected) return null;
  for (const surface of Array.isArray(hits.occluders) ? hits.occluders : []) {
    if (containsSurface(surface, x, y) && inFront(surface, frontSurface)) return null;
  }
  return selected;
}

function validProjection(projection) {
  if (!record(projection) || !validRect(projection.viewport)
      || (projection.screen !== undefined && !validRect(projection.screen))) return false;
  if (['plan', 'front'].includes(projection.kind)) {
    return record(projection.origin) && [projection.origin.x, projection.origin.y, projection.scale].every(finite)
      && projection.scale > 0;
  }
  if (projection.kind !== 'perspective' || !finite(projection.focal) || projection.focal <= 0
      || (projection.near !== undefined && (!finite(projection.near) || projection.near <= 0))) return false;
  const basis = projection.basis;
  if (!record(basis) || !['position', 'forward', 'right', 'up'].every(key => point3(basis[key]))) return false;
  const { forward, right, up } = basis;
  // The renderer gives an orthonormal basis. Reject malformed metadata rather
  // than pretending a scaled/skewed basis has the same inverse projection.
  return [forward, right, up].every(vector => Math.abs(dot(vector, vector) - 1) < 1e-5)
    && [dot(forward, right), dot(forward, up), dot(right, up)].every(value => Math.abs(value) < 1e-5);
}

function boundedPoint(point) {
  return point3(point) && ['x', 'y', 'z'].every(axis => Math.abs(point[axis]) <= WORLD_LIMIT);
}

/**
 * Invert a CSS-pixel pointer onto the horizontal plane at planeY. Return null
 * outside the displayed canvas region, on the horizon, behind the camera or
 * inside its near clip. Very distant intersections are rejected before editing.
 * plan screenY grows with world z, exactly as the overview renderer maps it.
 * front supplies an x-only drag anchor (z=0); it cannot recover world depth.
 * moveStageDrag preserves the original object z for this projection.
 */
export function screenToStagePlane(projection, pointer, planeY = 0) {
  if (!validProjection(projection) || !record(pointer) || !finite(pointer.x) || !finite(pointer.y)
      || !finite(planeY) || Math.abs(planeY) > WORLD_LIMIT
      || !inRect(projection.screen || projection.viewport, pointer.x, pointer.y)) return null;
  if (['plan', 'front'].includes(projection.kind)) {
    const point = { x: (pointer.x - projection.origin.x) / projection.scale,
      y: planeY, z: projection.kind === 'front' ? 0 : (pointer.y - projection.origin.y) / projection.scale };
    return boundedPoint(point) ? point : null;
  }
  const { basis, viewport, focal } = projection;
  const horizontal = (pointer.x - viewport.x - viewport.width / 2) / focal;
  const vertical = (viewport.y + viewport.height / 2 - pointer.y) / focal;
  const direction = {
    x: basis.forward.x + basis.right.x * horizontal + basis.up.x * vertical,
    y: basis.forward.y + basis.right.y * horizontal + basis.up.y * vertical,
    z: basis.forward.z + basis.right.z * horizontal + basis.up.z * vertical,
  };
  if (!point3(direction) || Math.abs(direction.y) <= EPSILON * Math.hypot(direction.x, direction.y, direction.z)) return null;
  const distance = (planeY - basis.position.y) / direction.y;
  // Camera-space forward depth equals this ray parameter for a unit basis.
  if (!finite(distance) || distance < (projection.near ?? NEAR)) return null;
  const point = { x: basis.position.x + direction.x * distance,
    y: planeY, z: basis.position.z + direction.z * distance };
  return boundedPoint(point) ? point : null;
}

function snapshotProjection(projection) {
  const copy = { kind: projection.kind, viewport: Object.freeze({ ...projection.viewport }),
    screen: Object.freeze({ ...(projection.screen || projection.viewport) }) };
  if (['plan', 'front'].includes(projection.kind)) {
    copy.origin = Object.freeze({ ...projection.origin }); copy.scale = projection.scale;
  } else {
    copy.basis = Object.freeze(Object.fromEntries(['position', 'forward', 'right', 'up']
      .map(key => [key, Object.freeze({ ...projection.basis[key] })])));
    copy.focal = projection.focal; copy.near = projection.near ?? NEAR;
  }
  return Object.freeze(copy);
}

/**
 * Start one drag with a frozen camera projection and object position. Use a
 * torso-height plane (floorY + heightM / 2), including when the pointer hits a
 * head above the floor horizon. The clicked offset survives without a snap.
 * Caller-owned stage-layout update functions constrain the resulting x/z.
 */
export function createStageDrag(options) {
  if (!record(options)) return null;
  const { projection, pointer, object } = options;
  if (!record(object) || !finite(object.x) || !finite(object.z)
      || Math.abs(object.x) > WORLD_LIMIT || Math.abs(object.z) > WORLD_LIMIT
      || !validProjection(projection)) return null;
  const floorY = object.floorY ?? 0, heightM = object.heightM ?? 0;
  const planeY = options.planeY === undefined ? floorY + heightM / 2 : options.planeY;
  const anchor = screenToStagePlane(projection, pointer, planeY);
  if (!anchor) return null;
  return Object.freeze({ projection: snapshotProjection(projection), planeY,
    anchor: Object.freeze(anchor), objectStart: Object.freeze({ x: object.x, z: object.z }) });
}

/** Move from the original pointer/object anchors, never from a rerendered camera. */
export function moveStageDrag(drag, pointer) {
  if (!record(drag) || !record(drag.objectStart) || !boundedPoint(drag.anchor)
      || !finite(drag.objectStart.x) || !finite(drag.objectStart.z)) return null;
  const point = screenToStagePlane(drag.projection, pointer, drag.planeY);
  if (!point) return null;
  const moved = { x: drag.objectStart.x + (point.x - drag.anchor.x),
    z: drag.projection.kind === 'front' ? drag.objectStart.z : drag.objectStart.z + (point.z - drag.anchor.z) };
  return finite(moved.x) && finite(moved.z)
    && Math.abs(moved.x) <= WORLD_LIMIT && Math.abs(moved.z) <= WORLD_LIMIT ? moved : null;
}
