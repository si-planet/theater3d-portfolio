/**
 * Perspective occlusion by opaque, planar stage faces. No scene dimensions are
 * changed: visible pieces are the original primitive minus face shadow cones.
 * Faces may be convex or concave simple polygons; a concave face is ear-clipped.
 */
const DEFAULT_EPSILON = 1e-7;
const DEFAULT_NEAR = 0.08;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const magnitude = p => Math.hypot(p.x, p.y, p.z);
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const finitePoint = p => p && [p.x, p.y, p.z].every(Number.isFinite);
const copy = p => ({ x: p.x, y: p.y, z: p.z });

function normalOf(points) {
  const normal = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  return normal;
}

function cleanVertices(vertices, epsilon) {
  const output = [];
  for (const vertex of vertices) {
    if (!output.length || magnitude(sub(vertex.point, output.at(-1).point)) > epsilon) output.push(vertex);
  }
  if (output.length > 1 && magnitude(sub(output[0].point, output.at(-1).point)) <= epsilon) output.pop();
  return output;
}

const cross2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function simpleOutline(points, epsilon) {
  const onSegment = (point, a, b, tolerance) => Math.abs(cross2(a, b, point)) <= tolerance
    && point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length];
    const tolerance = epsilon * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y));
    const c1 = cross2(a, b, c), c2 = cross2(a, b, d), c3 = cross2(c, d, a), c4 = cross2(c, d, b);
    const opposite = (left, right) => (left > tolerance && right < -tolerance) || (left < -tolerance && right > tolerance);
    if ((opposite(c1, c2) && opposite(c3, c4)) || onSegment(c, a, b, tolerance) || onSegment(d, a, b, tolerance)
      || onSegment(a, c, d, tolerance) || onSegment(b, c, d, tolerance)) return false;
  }
  return true;
}
function convexPieces(vertices, epsilon, allowNonPlanar = false) {
  let cleaned = cleanVertices(vertices, epsilon);
  if (cleaned.length < 3) return [];
  const rawNormal = normalOf(cleaned.map(vertex => vertex.point)), normalLength = magnitude(rawNormal);
  if (normalLength <= epsilon * epsilon) return [];
  const normal = { x: rawNormal.x / normalLength, y: rawNormal.y / normalLength, z: rawNormal.z / normalLength };
  const nonPlanar = cleaned.some(vertex => Math.abs(dot(normal, sub(vertex.point, cleaned[0].point))) > epsilon * 10);
  if (nonPlanar && !allowNonPlanar) return [];
  const drop = ['x', 'y', 'z'].reduce((best, axis) => Math.abs(normal[axis]) > Math.abs(normal[best]) ? axis : best, 'x');
  const axes = ['x', 'y', 'z'].filter(axis => axis !== drop);
  const projected = vertex => ({ x: vertex.point[axes[0]], y: vertex.point[axes[1]] });
  // Collinear boundary vertices obstruct ear detection without adding area.
  let changed = true;
  while (changed && cleaned.length > 3) {
    changed = false;
    for (let i = 0; i < cleaned.length; i++) {
      const a = projected(cleaned[(i + cleaned.length - 1) % cleaned.length]), b = projected(cleaned[i]), c = projected(cleaned[(i + 1) % cleaned.length]);
      const tolerance = epsilon * Math.max(1, Math.hypot(c.x - a.x, c.y - a.y));
      const left = cleaned[(i + cleaned.length - 1) % cleaned.length], middle = cleaned[i], right = cleaned[(i + 1) % cleaned.length];
      const edgeSquared = (c.x - a.x) ** 2 + (c.y - a.y) ** 2;
      const t = edgeSquared ? ((b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y)) / edgeSquared : 0;
      const linearLight = middle.light === undefined || Math.abs(middle.light - (left.light + (right.light - left.light) * t)) <= epsilon;
      if (linearLight && !nonPlanar && Math.abs(cross2(a, b, c)) <= tolerance && (b.x - a.x) * (b.x - c.x) + (b.y - a.y) * (b.y - c.y) <= tolerance) {
        cleaned.splice(i, 1); changed = true; break;
      }
    }
  }
  const projectedPoints = cleaned.map(projected);
  if (!allowNonPlanar && !simpleOutline(projectedPoints, epsilon)) return [];
  const area = projectedPoints.reduce((sum, a, i) => {
    const b = projectedPoints[(i + 1) % projectedPoints.length]; return sum + a.x * b.y - b.x * a.y;
  }, 0);
  if (Math.abs(area) <= epsilon * epsilon) return [];
  const orientation = Math.sign(area), tolerance = epsilon * epsilon;
  const turn = (a, b, c) => cross2(a, b, c) * orientation;
  if (!nonPlanar && projectedPoints.every((b, i) => turn(projectedPoints[(i + projectedPoints.length - 1) % projectedPoints.length], b, projectedPoints[(i + 1) % projectedPoints.length]) >= -tolerance)) return [cleaned];
  const indices = cleaned.map((_, index) => index), output = [];
  while (indices.length > 3) {
    let found = false;
    for (let i = 0; i < indices.length; i++) {
      const previous = indices[(i + indices.length - 1) % indices.length], current = indices[i], next = indices[(i + 1) % indices.length];
      const a = projectedPoints[previous], b = projectedPoints[current], c = projectedPoints[next];
      if (turn(a, b, c) <= tolerance) continue;
      if (indices.some(index => index !== previous && index !== current && index !== next
        && turn(a, b, projectedPoints[index]) >= -tolerance
        && turn(b, c, projectedPoints[index]) >= -tolerance
        && turn(c, a, projectedPoints[index]) >= -tolerance)) continue;
      output.push([cleaned[previous], cleaned[current], cleaned[next]]);
      indices.splice(i, 1); found = true; break;
    }
    // Invalid/self-intersecting faces must not invent an opaque convex hull.
    if (!found) return [];
  }
  output.push(indices.map(index => cleaned[index]));
  return output;
}

function plane(normal, point, threshold = 0) {
  const size = magnitude(normal);
  const n = { x: normal.x / size, y: normal.y / size, z: normal.z / size };
  return { normal: n, offset: -dot(n, point), threshold };
}
const signed = (boundary, point) => dot(boundary.normal, point) + boundary.offset - boundary.threshold;

function faceCone(points, camera, epsilon, faceIndex, pieceIndex) {
  let normal = normalOf(points), size = magnitude(normal);
  if (size <= epsilon * epsilon) return null;
  normal = { x: normal.x / size, y: normal.y / size, z: normal.z / size };
  const cameraSide = dot(normal, sub(camera, points[0]));
  if (Math.abs(cameraSide) <= epsilon) return null;
  if (cameraSide > 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  const facePlane = plane(normal, points[0]);
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
  const edges = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    let edgeNormal = cross(sub(a, camera), sub(b, camera));
    if (magnitude(edgeNormal) <= epsilon * epsilon) return null;
    if (dot(edgeNormal, sub(center, camera)) < 0) edgeNormal = { x: -edgeNormal.x, y: -edgeNormal.y, z: -edgeNormal.z };
    edges.push(plane(edgeNormal, camera, -epsilon));
  }
  // The face plane comes first so geometry wholly in front exits immediately.
  return { points, facePlane, edges, planes: [{ ...facePlane, threshold: epsilon }, ...edges], faceIndex, pieceIndex };
}

function splitVertices(vertices, boundary, epsilon) {
  const inside = [], outside = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    const da = signed(boundary, a.point), db = signed(boundary, b.point);
    if (da >= 0) inside.push(a);
    if (da <= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db), vertex = { point: interpolate(a.point, b.point, t) };
      if (a.light !== undefined) vertex.light = a.light + (b.light - a.light) * t;
      inside.push(vertex); outside.push(vertex);
    }
  }
  return { inside: cleanVertices(inside, epsilon), outside: cleanVertices(outside, epsilon) };
}

function nondegenerate(vertices, epsilon) {
  return vertices.length >= 3 && magnitude(normalOf(vertices.map(vertex => vertex.point))) > epsilon * epsilon;
}

function subtractCone(vertices, cone, epsilon) {
  let completelyInside = true;
  for (const boundary of cone.planes) {
    let min = Infinity, max = -Infinity;
    for (const vertex of vertices) {
      const distance = signed(boundary, vertex.point);
      min = Math.min(min, distance); max = Math.max(max, distance);
    }
    // In particular the leading face plane rejects geometry nearer than stage.
    if (max <= 0) return [vertices];
    if (min < 0) completelyInside = false;
  }
  if (completelyInside) return [];
  let remainder = vertices;
  const visible = [];
  for (const boundary of cone.planes) {
    const split = splitVertices(remainder, boundary, epsilon);
    if (nondegenerate(split.outside, epsilon)) visible.push(split.outside);
    remainder = split.inside;
    if (!nondegenerate(remainder, epsilon)) break;
  }
  return visible;
}

function blockedLineInterval(a, b, cone, epsilon) {
  let enter = 0, exit = 1;
  for (const boundary of cone.planes) {
    const start = signed(boundary, a), delta = signed(boundary, b) - start;
    if (Math.abs(delta) <= epsilon * epsilon) { if (start < 0) return null; continue; }
    const t = -start / delta;
    if (delta > 0) enter = Math.max(enter, t); else exit = Math.min(exit, t);
    if (exit <= enter) return null;
  }
  return [Math.max(0, enter), Math.min(1, exit)];
}

/**
 * createStageOccluder(faces, cameraPosition, { epsilon = 1e-7, near = .08 })
 * clipPolygon returns {points, vertexLight?} fragments; all coordinates remain
 * world coordinates. Its caller applies its existing near-plane projection.
 */
export function createStageOccluder(faces, cameraPosition, options = {}) {
  if (!finitePoint(cameraPosition)) throw new TypeError('A finite cameraPosition is required');
  const camera = copy(cameraPosition);
  const epsilon = Number.isFinite(options.epsilon) && options.epsilon > 0 ? options.epsilon : DEFAULT_EPSILON;
  const near = Number.isFinite(options.near) && options.near >= 0 ? options.near : DEFAULT_NEAR;
  const cones = [];
  let ignoredFaceCount = 0;
  for (const [faceIndex, face] of (Array.isArray(faces) ? faces : []).entries()) {
    const points = Array.isArray(face) ? face : face?.points;
    if (!Array.isArray(points) || !points.every(finitePoint)) { ignoredFaceCount++; continue; }
    const pieces = convexPieces(points.map(point => ({ point: copy(point) })), epsilon);
    if (!pieces.length) { ignoredFaceCount++; continue; }
    for (const [pieceIndex, vertices] of pieces.entries()) {
      const cone = faceCone(vertices.map(vertex => vertex.point), camera, epsilon, faceIndex, pieceIndex);
      if (cone) cones.push(cone);
    }
  }

  function clipPolygon(points, vertexLight) {
    if (!Array.isArray(points) || !points.every(finitePoint)) return [];
    const hasLights = Array.isArray(vertexLight) && vertexLight.length === points.length && vertexLight.every(Number.isFinite);
    // Most stage actors are above/in front of every cone. Preserve their exact
    // existing quad and light data, including slightly non-planar loft faces.
    const mightMeetCone = cones.some(cone => !cone.planes.some(boundary => points.every(point => signed(boundary, point) <= 0)));
    if (!mightMeetCone) return points.length >= 3 ? [{ points: points.map(copy), ...(hasLights ? { vertexLight: [...vertexLight] } : {}) }] : [];
    const vertices = points.map((point, index) => ({ point: copy(point), ...(hasLights ? { light: vertexLight[index] } : {}) }));
    // An intersected non-planar loft quad needs a defined surface. Triangles
    // retain its original corners and lights without moving any geometry.
    let fragments = convexPieces(vertices, epsilon, true);
    for (const cone of cones) {
      fragments = fragments.flatMap(fragment => subtractCone(fragment, cone, epsilon));
      if (!fragments.length) break;
    }
    return fragments.map(fragment => ({ points: fragment.map(vertex => vertex.point), ...(hasLights ? { vertexLight: fragment.map(vertex => vertex.light) } : {}) }));
  }

  function clipLine(points) {
    if (!Array.isArray(points) || points.length !== 2 || !points.every(finitePoint)) return [];
    const [a, b] = points;
    let intervals = [[0, 1]];
    for (const cone of cones) {
      const blocked = blockedLineInterval(a, b, cone, epsilon);
      if (!blocked) continue;
      intervals = intervals.flatMap(([start, end]) => {
        const enter = Math.max(start, blocked[0]), exit = Math.min(end, blocked[1]);
        if (exit <= enter) return [[start, end]];
        return [...(enter > start ? [[start, enter]] : []), ...(exit < end ? [[exit, end]] : [])];
      });
      if (!intervals.length) break;
    }
    return intervals.map(([start, end]) => [interpolate(a, b, start), interpolate(a, b, end)]);
  }

  const isPointOccluded = point => finitePoint(point) && cones.some(cone => cone.planes.every(boundary => signed(boundary, point) >= 0));

  function classifySphere(center, radius) {
    if (!finitePoint(center) || !Number.isFinite(radius) || radius < 0) return 'visible';
    let boundaryHit = false;
    for (const cone of cones) {
      let outside = false, inside = true;
      for (const boundary of cone.planes) {
        const distance = signed(boundary, center);
        if (distance + radius < 0) { outside = true; break; }
        if (distance - radius < 0) inside = false;
      }
      if (outside) continue;
      if (inside) return 'hidden';
      boundaryHit = true;
    }
    return boundaryHit ? 'boundary' : 'visible';
  }

  function nearestHitFrom(origin, direction, maxT = Infinity, minT = 0) {
    let nearest = null;
    for (const cone of cones) {
      const denominator = dot(cone.facePlane.normal, direction);
      if (Math.abs(denominator) <= epsilon * epsilon) continue;
      const t = -(dot(cone.facePlane.normal, origin) + cone.facePlane.offset) / denominator;
      if (!(t > minT + epsilon && t < maxT - epsilon && (!nearest || t < nearest.t))) continue;
      const point = { x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t };
      if (cone.edges.every(boundary => signed(boundary, point) >= 0)) nearest = { t, point, faceIndex: cone.faceIndex, pieceIndex: cone.pieceIndex };
    }
    return nearest;
  }

  const nearestRayHit = (direction, maxT = Infinity, minT = 0) => finitePoint(direction) ? nearestHitFrom(camera, direction, maxT, minT) : null;

  /**
   * Pixel-center visibility of the mathematical sphere, preserving the caller's
   * original radial-gradient fill through a clip path. Runs are DEVICE pixels:
   * ctx.rect(run.x/dpr, run.y/dpr, run.width/dpr, run.height/dpr).
   * Only boundary spheres need this function; fully visible spheres keep their
   * original drawing. A sphere crossing near is cut at near with a solid cap.
   */
  function sphereVisibleRuns(center, radius, basis, viewport, focal, screenBounds = viewport, dpr = 1) {
    const result = { coordinateSpace: 'device-pixel', dpr, runs: [], testedPixelCount: 0, visiblePixelCount: 0, near };
    if (!finitePoint(center) || !(radius > 0) || !basis || !viewport || !screenBounds || !(dpr > 0) || !(focal > 0)) return result;
    const centerDelta = sub(center, camera), cx = dot(centerDelta, basis.right), cy = dot(centerDelta, basis.up), cz = dot(centerDelta, basis.forward);
    const midX = viewport.x + viewport.width / 2, midY = viewport.y + viewport.height / 2;
    let minX = screenBounds.x, maxX = screenBounds.x + screenBounds.width;
    let minY = screenBounds.y, maxY = screenBounds.y + screenBounds.height;
    const orthographicScale = viewport.orthographicScale;
    if (orthographicScale !== undefined) {
      minX = Math.max(minX, midX + (cx - radius) * orthographicScale); maxX = Math.min(maxX, midX + (cx + radius) * orthographicScale);
      minY = Math.max(minY, midY - (cy + radius) * orthographicScale); maxY = Math.min(maxY, midY - (cy - radius) * orthographicScale);
    } else if (cz > radius) {
      const tangent = value => {
        const root = radius * Math.sqrt(Math.max(0, value * value + cz * cz - radius * radius)), denominator = cz * cz - radius * radius;
        return [(value * cz - root) / denominator, (value * cz + root) / denominator];
      };
      const horizontal = tangent(cx), vertical = tangent(cy);
      minX = Math.max(minX, midX + horizontal[0] * focal); maxX = Math.min(maxX, midX + horizontal[1] * focal);
      minY = Math.max(minY, midY - vertical[1] * focal); maxY = Math.min(maxY, midY - vertical[0] * focal);
    }
    const left = Math.floor(minX * dpr), right = Math.ceil(maxX * dpr), top = Math.floor(minY * dpr), bottom = Math.ceil(maxY * dpr);
    if (!(right > left && bottom > top) || cz + radius < near) return result;
    let previousRuns = new Map();
    for (let y = top; y < bottom; y++) {
      const currentRuns = new Map();
      let runStart = null;
      const finishRun = x => {
        if (runStart === null) return;
        const width = x - runStart, key = `${runStart}:${width}`;
        const previous = previousRuns.get(key);
        const run = previous && previous.y + previous.height === y ? previous : { x: runStart, y, width, height: 0 };
        if (run !== previous) result.runs.push(run);
        run.height++; currentRuns.set(key, run); runStart = null;
      };
      for (let x = left; x < right; x++) {
        result.testedPixelCount++;
        const px = (x + .5) / dpr, py = (y + .5) / dpr;
        const rx = (px - midX) / (orthographicScale ?? focal), ry = -(py - midY) / (orthographicScale ?? focal);
        const origin = orthographicScale !== undefined
          ? { x: camera.x + basis.right.x * rx + basis.up.x * ry, y: camera.y + basis.right.y * rx + basis.up.y * ry, z: camera.z + basis.right.z * rx + basis.up.z * ry } : camera;
        const direction = orthographicScale !== undefined ? basis.forward
          : { x: basis.forward.x + basis.right.x * rx + basis.up.x * ry, y: basis.forward.y + basis.right.y * rx + basis.up.y * ry, z: basis.forward.z + basis.right.z * rx + basis.up.z * ry };
        const offset = sub(origin, center), a = dot(direction, direction), b = dot(offset, direction), c = dot(offset, offset) - radius * radius;
        const discriminant = b * b - a * c;
        let visible = false;
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant), front = (-b - root) / a, back = (-b + root) / a;
          const t = Math.max(front, near);
          visible = back >= t && !nearestHitFrom(origin, direction, t, near);
        }
        if (visible) { result.visiblePixelCount++; if (runStart === null) runStart = x; }
        else finishRun(x);
      }
      finishRun(right); previousRuns = currentRuns;
    }
    return result;
  }

  return { clipPolygon, clipLine, classifySphere, isPointOccluded, nearestRayHit, sphereVisibleRuns,
    faceCount: Array.isArray(faces) ? faces.length : 0, coneCount: cones.length, ignoredFaceCount, epsilon, near };
}
