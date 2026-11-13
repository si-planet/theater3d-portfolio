import { createSeatList, normalizeGeometry, seatPosition, stageBounds } from './geometry.js';
import { buildStageEnclosure } from './stage-enclosure.js';
import { getAuditoriumBarriers, SEATED_KNEE_GEOMETRY } from './auditorium-barriers.js';
import { resolveBodyProfile } from './body-profile.js';
import { buildActorMesh } from './actor-mesh.js';
import { createStageOccluder } from './stage-occlusion.js';

export const SCENE_COLORS = Object.freeze({
  stageFloor: '#dadde1', stageFront: '#eef0f2', stageEdge: '#838b95',
  audienceFloor: '#c7cbd1', hallFloor: '#e3e6ea',
  backWall: '#c2c6cb', sideWall: '#acb2ba', wallEdge: '#737b86',
  auditoriumBarrier: '#8b939d', auditoriumBarrierEdge: '#535d69',
});

const TAU = Math.PI * 2;
const NEAR = 0.08;
const overviewCache = new WeakMap();
const orbitRowLabelCache = new WeakMap();
const copyRowAnnotations = annotations => annotations.map(annotation => ({ ...annotation,
  officialRowLabels: [...annotation.officialRowLabels], anchor: { ...annotation.anchor },
  bounds: { ...annotation.bounds }, leader: annotation.leader.map(point => ({ ...point })),
}));
/** Last actual orbit overlay in CSS pixels; callers cannot mutate renderer state. */
export function getOrbitRowLabelAnnotations(canvas) {
  return copyRowAnnotations(orbitRowLabelCache.get(canvas) || []);
}
// Retain only the latest immutable world-space mesh per actor. Appearance,
// selection and projections are recomputed for the current view each frame.
const actorGeometryCache = new Map();
const ACTOR_GEOMETRY_CACHE_LIMIT = 128;
function cachedActorMesh(person, detail) {
  const key = JSON.stringify([person.x, person.z, person.floorY, person.heightM,
    person.bodyPreset, person.facingDeg, person.pose || 'standing', detail?.crowd === true,
    detail?.segments ?? 28, detail?.capSteps ?? 8]);
  const previous = actorGeometryCache.get(person.id);
  if (previous?.key === key) return previous.mesh;
  const mesh = buildActorMesh(person, detail);
  actorGeometryCache.delete(person.id);
  actorGeometryCache.set(person.id, { key, mesh });
  if (actorGeometryCache.size > ACTOR_GEOMETRY_CACHE_LIMIT) {
    actorGeometryCache.delete(actorGeometryCache.keys().next().value);
  }
  return mesh;
}
const finite = (value, fallback) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const vec = (x, y, z) => ({ x, y, z });
const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a, n) => vec(a.x * n, a.y * n, a.z * n);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => mul(a, 1 / (length(a) || 1));

function canvasSize(canvas) {
  const rect = canvas.getBoundingClientRect?.() || {};
  return {
    width: Math.max(1, rect.width || canvas.clientWidth || 960),
    height: Math.max(1, rect.height || canvas.clientHeight || 540),
  };
}

function prepareCanvas(canvas) {
  const { width, height } = canvasSize(canvas);
  const dpr = clamp(finite(globalThis.devicePixelRatio, 1), 1, 3);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { ctx, width, height, dpr };
}

function roundedRect(ctx, x, y, width, height, radius = 5) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundedRectPoints(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2)), points = [];
  const corners = [
    [{ x: x + width - r, y }, { x: x + width, y }, { x: x + width, y: y + r }],
    [{ x: x + width, y: y + height - r }, { x: x + width, y: y + height }, { x: x + width - r, y: y + height }],
    [{ x: x + r, y: y + height }, { x, y: y + height }, { x, y: y + height - r }],
    [{ x, y: y + r }, { x, y }, { x: x + r, y }],
  ];
  for (const [start, control, end] of corners) {
    points.push(start);
    for (let step = 1; step <= 4; step += 1) {
      const t = step / 4, s = 1 - t;
      points.push({ x: s * s * start.x + 2 * s * t * control.x + t * t * end.x, y: s * s * start.y + 2 * s * t * control.y + t * t * end.y });
    }
  }
  return points;
}

function shade(color, multiplier = 1) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color || '');
  if (!hex) return color || '#75d7cb';
  const raw = hex[1].length === 3 ? [...hex[1]].map((n) => n + n).join('') : hex[1];
  const rgb = [0, 2, 4].map((offset) => clamp(Math.round(parseInt(raw.slice(offset, offset + 2), 16) * multiplier), 0, 255));
  return `rgb(${rgb.join(',')})`;
}

function woodTint(color) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color || '');
  if (!hex) return color;
  const raw = hex[1].length === 3 ? [...hex[1]].map(n => n + n).join('') : hex[1];
  const wood = [210, 180, 139];
  return '#' + [0, 2, 4].map((offset, index) => Math.round(parseInt(raw.slice(offset, offset + 2), 16) * .72 + wood[index] * .28).toString(16).padStart(2, '0')).join('');
}

function cameraBasis(position, target) {
  let forward = unit(sub(target, position));
  if (length(sub(target, position)) < 0.001) forward = vec(0, 0, -1);
  let right = cross(forward, vec(0, 1, 0));
  if (length(right) < 0.001) right = vec(1, 0, 0);
  right = unit(right);
  return { position, forward, right, up: unit(cross(right, forward)) };
}

function cameraPoint(point, basis) {
  const delta = sub(point, basis.position);
  return { x: dot(delta, basis.right), y: dot(delta, basis.up), depth: dot(delta, basis.forward) };
}

function project(point, basis, viewport, focal) {
  const camera = cameraPoint(point, basis);
  return {
    ...projectCamera(camera, viewport, focal),
    depth: camera.depth,
    visible: camera.depth >= NEAR,
  };
}

function projectCamera(point, viewport, focal) {
  const scale = viewport.orthographicScale ?? focal / point.depth;
  return {
    x: viewport.x + viewport.width / 2 + point.x * scale,
    y: viewport.y + viewport.height / 2 - point.y * scale,
  };
}

// A camera turned sideways can place an off-screen reference point exactly on
// its depth=0 plane. Keep metadata finite without marking that point visible.
function projectSafe(point, basis, viewport, focal) {
  const camera = cameraPoint(point, basis);
  return { ...projectCamera({ ...camera, depth: Math.max(NEAR, camera.depth) }, viewport, focal), depth: camera.depth, visible: camera.depth >= NEAR };
}

// Clip in camera space before division. This keeps nearby seat backs stable.
function clipNear(points, basis, vertexLight) {
  const input = points.map((point, index) => ({ ...cameraPoint(point, basis), ...(vertexLight ? { light: vertexLight[index] } : {}) }));
  const output = [];
  for (let i = 0; i < input.length; i += 1) {
    const a = input[i];
    const b = input[(i + 1) % input.length];
    const aInside = a.depth >= NEAR;
    const bInside = b.depth >= NEAR;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const t = (NEAR - a.depth) / (b.depth - a.depth);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, depth: NEAR,
        ...(vertexLight ? { light: a.light + (b.light - a.light) * t } : {}) });
    }
  }
  return output;
}

function addPolygon(items, points, fill, stroke, lineWidth = 0.6) {
  items.push({ type: 'polygon', points, fill, stroke, lineWidth });
}

function addBox(items, x, y, z, width, height, depth, color, edge = '#717985') {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y;
  const y1 = y + height;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  const a = vec(x0, y0, z0), b = vec(x1, y0, z0), c = vec(x1, y0, z1), d = vec(x0, y0, z1);
  const e = vec(x0, y1, z0), f = vec(x1, y1, z0), g = vec(x1, y1, z1), h = vec(x0, y1, z1);
  addPolygon(items, [a, b, f, e], shade(color, 0.68), edge);
  addPolygon(items, [b, c, g, f], shade(color, 0.8), edge);
  addPolygon(items, [c, d, h, g], shade(color, 0.92), edge);
  addPolygon(items, [d, a, e, h], shade(color, 0.76), edge);
  addPolygon(items, [e, f, g, h], shade(color, 1.12), edge);
}

function addCylinder(items, bottom, top, radius, color, segments = 10, edge) {
  const axis = unit(sub(top, bottom));
  const reference = Math.abs(axis.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = unit(cross(axis, reference));
  const v = unit(cross(axis, u));
  const lower = [], upper = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = TAU * i / segments;
    const offset = add(mul(u, Math.cos(angle) * radius), mul(v, Math.sin(angle) * radius));
    lower.push(add(bottom, offset));
    upper.push(add(top, offset));
  }
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    addPolygon(items, [lower[i], lower[next], upper[next], upper[i]], shade(color, 0.78 + 0.2 * Math.cos(TAU * i / segments)), undefined);
    if (edge) items.push({ type: 'line', points: [lower[i], lower[next]], color: edge, lineWidth: 1 });
  }
  addPolygon(items, upper, shade(color, 1.08), edge);
}

// Rounded ends are real hemisphere faces, so they keep their volume when a
// person turns and clip at the same near plane as the rest of the scene.
function addCapsule(items, bottom, top, radius, color, { radialScale = 1, radialReference, brightness = 1, segments = 28, capSteps = 8 } = {}) {
  const axis = unit(sub(top, bottom));
  const reference = radialReference || (Math.abs(axis.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0));
  const u = unit(cross(axis, reference)), v = unit(cross(axis, u));
  const rings = [];
  const ring = (center, angle) => Array.from({ length: segments }, (_, index) => {
    const azimuth = TAU * index / segments;
    const radial = add(mul(u, Math.cos(azimuth) * radialScale), mul(v, Math.sin(azimuth)));
    const radialNormal = add(mul(u, Math.cos(azimuth) / radialScale), mul(v, Math.sin(azimuth)));
    return {
      point: add(center, add(mul(axis, Math.sin(angle) * radius), mul(radial, Math.cos(angle) * radius))),
      normal: unit(add(mul(axis, Math.sin(angle)), mul(radialNormal, Math.cos(angle)))),
    };
  });
  for (let step = 0; step <= capSteps; step += 1) rings.push(ring(bottom, -Math.PI / 2 + step * Math.PI / (2 * capSteps)));
  for (let step = 0; step <= capSteps; step += 1) rings.push(ring(top, step * Math.PI / (2 * capSteps)));
  const light = unit(vec(-0.45, 0.75, 0.6));
  for (let row = 0; row + 1 < rings.length; row += 1) {
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const face = [rings[row][index], rings[row][next], rings[row + 1][next], rings[row + 1][index]];
      const normal = unit(face.reduce((sum, vertex) => add(sum, vertex.normal), vec(0, 0, 0)));
      addPolygon(items, face.map(vertex => vertex.point), shade(color, (0.88 + dot(normal, light) * 0.23) * brightness), undefined);
      items.at(-1).surfaceNormal = normal;
      items.at(-1).surfaceCenter = mul(face.reduce((sum, vertex) => add(sum, vertex.point), vec(0, 0, 0)), 1 / face.length);
    }
  }
}

function personData(person, index, g) {
  const bodyProfile = resolveBodyProfile({ heightM: person.heightM, bodyPreset: person.bodyPreset });
  return {
    id: person.id ?? `person-${index + 1}`,
    x: finite(person.x, 0),
    z: finite(person.z, -g.stageDepthM / 2),
    heightM: bodyProfile.heightM, bodyPreset: bodyProfile.bodyPreset, bodyProfile, pose: person.pose || 'standing',
    color: person.color || ['#75d7cb', '#f2be78', '#aa9fe8', '#ef8f98', '#8cbee9'][index % 5],
    name: String(person.name || `인물 ${index + 1}`).slice(0, 40),
    selected: Boolean(person.selected),
    facingDeg: (((finite(person.facingDeg, 0) + 180) % 360) + 360) % 360 - 180,
    floorY: g.stageHeightM,
  };
}

function addPerson(items, person, detail) {
  const { x, z, heightM: h, floorY: y, color } = person;
  const angle = person.facingDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const point = (dx, dy, dz = 0) => vec(x + (dx * cos + dz * sin) * h, y + dy * h, z + (-dx * sin + dz * cos) * h);
  const start = items.length;
  const mesh = cachedActorMesh(person, detail);
  person.meshBounds = mesh.bounds;
  const light = unit(vec(-0.45, 0.75, 0.6));
  const shape = mesh.bodyProfile.shapeRatios;
  const materialColor = woodTint(color);
  const smoothstep = (start, end, value) => { const t = clamp((value - start) / (end - start), 0, 1); return t * t * (3 - 2 * t); };
  for (const face of mesh.faces) {
    const surfaceColor = face.part === 'torso_front_marker' ? shade(color, .55) : materialColor;
    const torso = face.part === 'torso_neck_head';
    const pelvisSurface = torso || face.part === 'upper_leg' || face.part === 'hip_joint';
    const vertexLight = face.normals.map((normal, index) => {
      const surfaceLight = (0.91 + dot(normal, light) * .16) * face.brightness;
      if (!pelvisSurface) return surfaceLight;
      const relativeY = (face.points[index].y - y - (torso ? mesh.torsoOffsetM || 0 : 0)) / h;
      const pelvisBlend = relativeY > shape.crotchY - .025 && relativeY < shape.hipY + .034
        ? smoothstep(shape.crotchY - .025, shape.crotchY + .01, relativeY)
          * (1 - smoothstep(shape.hipY + .01, shape.hipY + .034, relativeY)) : 0;
      // These surfaces overlap inside the pelvis. Sharing their finish keeps
      // the hidden joint caps from painting a scalloped or triangular seam.
      const finish = surfaceLight * (1 - pelvisBlend) + .92 * pelvisBlend;
      if (!torso) return finish;
      const waistJoint = relativeY > shape.waistY - .039 && relativeY < shape.waistY + .035
        ? smoothstep(shape.waistY - .039, shape.waistY - .014, relativeY)
          * (1 - smoothstep(shape.waistY + .012, shape.waistY + .035, relativeY)) : 0;
      const neckJoint = relativeY > shape.neckBottomY + .031 && relativeY < shape.neckTopY - .001
        ? smoothstep(shape.neckBottomY + .031, shape.neckBottomY + .042, relativeY)
          * (1 - smoothstep(shape.neckTopY - .016, shape.neckTopY - .001, relativeY)) : 0;
      return finish * (1 - .13 * waistJoint - .11 * neckJoint);
    });
    addPolygon(items, face.points, shade(surfaceColor, vertexLight.reduce((sum, value) => sum + value, 0) / vertexLight.length), undefined);
    Object.assign(items.at(-1), { surfaceNormal: face.surfaceNormal, surfaceCenter: face.surfaceCenter,
      surfaceColor, vertexLight, sealSurface: true, actorPart: face.part });
  }
  for (let i = start; i < items.length; i += 1) {
    items[i].stageObjectId = person.id;
    items[i].stageObjectKind = 'person';
    if (items[i].type === 'polygon') items[i].sealSurface = true;
  }
  const adornmentStart = items.length;
  // A floor shadow helps read where the person stands on an empty stage.
  const shadow = Array.from({ length: 16 }, (_, i) => point(Math.cos(TAU * i / 16) * 0.18, 0.006, Math.sin(TAU * i / 16) * 0.09));
  addPolygon(items, shadow, 'rgba(0,0,0,0.24)', undefined);
  items.push({ type: 'line', points: [point(0, 0.012, 0.14), point(0, 0.012, 0.48)], color: '#20242a', lineWidth: 1.4 });
  addPolygon(items, [point(-0.07, 0.013, 0.42), point(0.07, 0.013, 0.42), point(0, 0.013, 0.56)], '#20242a', '#565d66', 0.5);
  if (person.selected) {
    const outline = Array.from({ length: 16 }, (_, i) => point(Math.cos(TAU * i / 16) * 0.21, 0.012, Math.sin(TAU * i / 16) * 0.13));
    outline.forEach((p, i) => items.push({ type: 'line', points: [p, outline[(i + 1) % outline.length]], color: '#17191c', lineWidth: 1.2 }));
    items.push({ type: 'label', position: point(0, 1.1), text: person.name, color: '#17191c', fontSize: 10 });
  }
  for (let i = adornmentStart; i < items.length; i += 1) items[i].stageAdornment = true;
}

function audienceData(person, index, g) {
  if (!person || typeof person !== 'object') return null;
  const seat = person.seat && Number.isInteger(Number(person.seat.row)) && Number(person.seat.row) > 0 && Number.isInteger(Number(person.seat.number)) && Number(person.seat.number) > 0
    ? { row: Number(person.seat.row), number: Number(person.seat.number) } : null;
  const mapped = seat ? (g.seats
    ? g.seats.find(item => item.row === seat.row && item.number === seat.number)
    : seat.row <= g.rowCount && seat.number <= g.seatsPerRow ? seatPosition(g, seat, 0) : null) : null;
  const x = finite(person.x, mapped?.x), z = finite(person.z, mapped?.z), floorY = finite(person.floorY, mapped?.floorY);
  if (![x, z, floorY].every(Number.isFinite)) return null;
  const heightM = clamp(finite(person.heightM, person.preset === 'female' ? 1.23 : 1.30), 0.65, 2.5);
  return {
    id: person.id ?? `audience-${index + 1}`,
    name: String(person.name || `관객 ${index + 1}`).slice(0, 40),
    seat, preset: person.preset ?? null, pose: 'seated',
    x: clamp(x, -1000, 1000), z: clamp(z, -1000, 1000), floorY: clamp(floorY, -1000, 1000),
    heightM, seatHeightM: clamp(finite(person.seatHeightM, 0.45), 0.08, heightM * 0.65),
    rotationDeg: ((finite(person.rotationDeg, mapped?.rotationDeg || 0) % 360) + 360) % 360,
    color: person.color || (person.preset === 'female' ? '#b6a2d8' : '#88b5d8'),
    selected: Boolean(person.selected),
  };
}

function normalizedAudience(audience, g, selectedId) {
  const ids = new Set();
  return (Array.isArray(audience) ? audience : []).map((person, index) => audienceData(person, index, g)).filter(person => {
    if (!person || ids.has(person.id)) return false;
    ids.add(person.id);
    if (selectedId !== undefined) person.selected = person.id === selectedId;
    return true;
  });
}

function seatedPoint(person, x, y, z = 0) {
  const angle = person.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return vec(person.x + x * cos + z * sin, person.floorY + y, person.z - x * sin + z * cos);
}

/** heightM is floor-to-head-top, not a standing height added to the chair. */
function addSeatedPerson(items, person) {
  const { heightM: h, seatHeightM: seatY, color } = person;
  const p = (x, y, z = 0) => seatedPoint(person, x, y, z);
  const headRadius = h * 0.10, shoulderY = h - headRadius * 2 - 0.035;
  const waistY = seatY + 0.05, shoulderWidth = h * 0.17, hipWidth = h * 0.14;
  const front = [p(-hipWidth, waistY, -0.075), p(hipWidth, waistY, -0.075), p(shoulderWidth, shoulderY, -0.07), p(-shoulderWidth, shoulderY, -0.07)];
  const back = [p(-hipWidth, waistY, 0.075), p(hipWidth, waistY, 0.075), p(shoulderWidth, shoulderY, 0.065), p(-shoulderWidth, shoulderY, 0.065)];
  addPolygon(items, front, color, shade(color, 0.75));
  addPolygon(items, back, shade(color, 0.78), undefined);
  for (let i = 0; i < 4; i += 1) addPolygon(items, [front[i], front[(i + 1) % 4], back[(i + 1) % 4], back[i]], shade(color, i === 2 ? 1.1 : 0.85), undefined);
  addRotatedBox(items, person, person.floorY + seatY - 0.02, -0.02, hipWidth * 2, 0.10, 0.23, shade(color, 0.9), shade(color, 0.7));
  for (const side of [-1, 1]) {
    const legX = side * h * 0.095;
    const knee = SEATED_KNEE_GEOMETRY;
    addCylinder(items, p(legX, seatY + knee.thighBackYOffset, knee.thighBackZ), p(legX, seatY + knee.kneeYOffset, knee.kneeZ), h * knee.thighRadiusRatio, shade(color, 0.8), knee.radialSegments);
    addCylinder(items, p(legX, seatY + knee.kneeYOffset, knee.kneeZ), p(legX, knee.shinFootY, knee.shinFootZ), h * knee.shinRadiusRatio, shade(color, 0.75), knee.radialSegments);
    const foot = p(legX, 0, 0);
    addRotatedBox(items, { ...person, x: foot.x, z: foot.z }, person.floorY + 0.008, -0.4, h * 0.082, 0.055, h * 0.14, shade(color, 0.65), undefined);
    addCylinder(items, p(side * (shoulderWidth + 0.015), shoulderY - 0.03, -0.01), p(side * h * 0.18, seatY + 0.14, -0.21), h * 0.032, color, 6);
  }
  addCylinder(items, p(0, shoulderY - 0.025), p(0, h - headRadius * 1.8), h * 0.038, shade(color, 1.06), 6);
  items.push({ type: 'sphere', center: p(0, h - headRadius), radius: headRadius, color, stroke: person.selected ? '#17191c' : undefined, lineWidth: 2 });
  if (person.selected) {
    items.push({ type: 'label', position: p(0, h + 0.16), text: person.name, color: '#17191c', fontSize: 10 });
  }
}

function sphereIntersectsView(center, radius, basis, viewport, focal) {
  const point = cameraPoint(center, basis), farDepth = point.depth + radius;
  if (farDepth < NEAR) return false;
  return Math.abs(point.x) <= farDepth * viewport.width / (2 * focal) + radius
    && Math.abs(point.y) <= farDepth * viewport.height / (2 * focal) + radius;
}

function addAudience(items, audience, view) {
  for (const person of audience) {
    const radius = Math.hypot(person.heightM * 0.30, person.heightM / 2, 0.56);
    if (view && !sphereIntersectsView(vec(person.x, person.floorY + person.heightM / 2, person.z), radius, view.basis, view.viewport, view.focal)) continue;
    const start = items.length;
    addSeatedPerson(items, person);
    for (let i = start; i < items.length; i += 1) {
      items[i].audienceId = person.id;
      if (person.selected && items[i].type === 'polygon') { items[i].stroke = '#17191c'; items[i].lineWidth = 0.9; }
    }
  }
}

function audienceProjections(audience, basis, viewport, focal, screen = viewport) {
  const safeProject = point => {
    const camera = cameraPoint(point, basis);
    return { ...projectCamera({ ...camera, depth: Math.max(NEAR, camera.depth) }, viewport, focal), depth: camera.depth, visible: camera.depth >= NEAR };
  };
  return audience.map(person => {
    const mesh = []; addSeatedPerson(mesh, person);
    const points = [], depths = [];
    for (const item of mesh) {
      if (item.type === 'polygon') {
        depths.push(...item.points.map(point => cameraPoint(point, basis).depth));
        points.push(...clipNear(item.points, basis).map(point => projectCamera(point, viewport, focal)));
      } else if (item.type === 'sphere') {
        const center = project(item.center, basis, viewport, focal);
        depths.push(center.depth - item.radius);
        if (center.depth > item.radius + NEAR) {
          const radius = focal * item.radius / Math.sqrt(center.depth ** 2 - item.radius ** 2);
          for (let i = 0; i < 16; i += 1) points.push({ x: center.x + Math.cos(TAU * i / 16) * radius, y: center.y + Math.sin(TAU * i / 16) * radius });
        }
      }
    }
    const feet = safeProject(vec(person.x, person.floorY, person.z)), top = safeProject(vec(person.x, person.floorY + person.heightM, person.z));
    const polygon = convexHull(points), bounds = pixelBounds(polygon), frontVisible = Boolean(bounds);
    const visible = Boolean(bounds && bounds.x <= screen.x + screen.width && bounds.x + bounds.width >= screen.x && bounds.y <= screen.y + screen.height && bounds.y + bounds.height >= screen.y);
    const inFrame = Boolean(bounds && bounds.x >= screen.x && bounds.x + bounds.width <= screen.x + screen.width && bounds.y >= screen.y && bounds.y + bounds.height <= screen.y + screen.height);
    const nearClipped = depths.some(depth => depth < NEAR);
    return { id: person.id, name: person.name, type: 'audience', pose: 'seated', seat: person.seat, preset: person.preset, selected: person.selected, feet, top, heightPx: Math.abs(feet.y - top.y), distanceM: length(sub(vec(person.x, person.floorY + person.heightM / 2, person.z), basis.position)), floorY: person.floorY, heightM: person.heightM, seatHeightM: person.seatHeightM, rotationDeg: person.rotationDeg, bounds, polygon, frontVisible, visible, inFrame, nearClipped, clipped: nearClipped || !inFrame };
  });
}

function structureData(structure, index, g) {
  if (!structure || !['box', 'cylinder'].includes(structure.type)) return null;
  const dimension = (value, fallback) => clamp(finite(value, fallback), 0.05, 100);
  const diameterM = dimension(structure.diameterM, 1);
  return {
    id: structure.id ?? `structure-${index + 1}`,
    name: String(structure.name || `${structure.type === 'cylinder' ? '원통' : '상자'} ${index + 1}`).slice(0, 40),
    type: structure.type,
    x: clamp(finite(structure.x, 0), -1000, 1000),
    z: clamp(finite(structure.z, -g.stageDepthM / 2), -1000, 1000),
    floorY: clamp(finite(structure.floorY, g.stageHeightM), -1000, 1000),
    widthM: structure.type === 'cylinder' ? diameterM : dimension(structure.widthM, 1.5),
    depthM: structure.type === 'cylinder' ? diameterM : dimension(structure.depthM, 1),
    heightM: dimension(structure.heightM, 1.2),
    diameterM,
    rotationDeg: ((finite(structure.rotationDeg, 0) % 360) + 360) % 360,
    color: structure.color || (structure.type === 'cylinder' ? '#8c9bc8' : '#ba8760'),
    selected: Boolean(structure.selected),
  };
}

function normalizedStructures(structures, g) {
  const ids = new Set();
  return (Array.isArray(structures) ? structures : []).map((structure, index) => structureData(structure, index, g)).filter(structure => {
    if (!structure || ids.has(structure.id)) return false;
    ids.add(structure.id);
    return true;
  });
}

function structureFootprint(structure) {
  if (structure.type === 'cylinder') return Array.from({ length: 24 }, (_, index) => ({
    x: structure.x + Math.cos(TAU * index / 24) * structure.diameterM / 2,
    z: structure.z + Math.sin(TAU * index / 24) * structure.diameterM / 2,
  }));
  const angle = structure.rotationDeg * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = sx * structure.widthM / 2, z = sz * structure.depthM / 2;
    return { x: structure.x + x * cos + z * sin, z: structure.z - x * sin + z * cos };
  });
}

function addStructures(items, structures, compact = false) {
  for (const structure of structures) {
    const start = items.length;
    const edge = structure.selected ? '#17191c' : undefined;
    if (structure.type === 'cylinder') {
      addCylinder(items, vec(structure.x, structure.floorY, structure.z), vec(structure.x, structure.floorY + structure.heightM, structure.z), structure.diameterM / 2, structure.color, 24, edge);
    } else {
      addRotatedBox(items, structure, structure.floorY, 0, structure.widthM, structure.heightM, structure.depthM, structure.color, edge || '#665044');
    }
    for (let i = start; i < items.length; i += 1) {
      items[i].stageObjectId = structure.id;
      items[i].stageObjectKind = 'structure';
    }
    if (structure.selected || (!compact && structures.length <= 4)) {
      items.push({ type: 'label', position: vec(structure.x, structure.floorY + structure.heightM + 0.16, structure.z), text: structure.name, color: structure.selected ? '#17191c' : '#343a42', fontSize: 10 });
    }
  }
}

function fitSceneBounds(bounds, actors, structures, audience = []) {
  const result = { ...bounds };
  const include = (x, y, z) => {
    result.xMin = Math.min(result.xMin, x); result.xMax = Math.max(result.xMax, x);
    result.yMin = Math.min(result.yMin, y); result.yMax = Math.max(result.yMax, y);
    result.zMin = Math.min(result.zMin, z); result.zMax = Math.max(result.zMax, z);
  };
  for (const actor of actors) {
    const radius = actor.heightM * 0.25;
    if (actor.pose === 'chair' || actor.pose === 'floor' || actor.pose === 'cross-legged') {
      const bounds = cachedActorMesh(actor,{segments:12,capSteps:3}).bounds;
      include(bounds.xMin,bounds.yMin,bounds.zMin);include(bounds.xMax,bounds.yMax+.25,bounds.zMax);
    } else {
      include(actor.x - radius, actor.floorY, actor.z - radius);
      include(actor.x + radius, actor.floorY + actor.heightM * (actor.selected ? 1.16 : 1), actor.z + radius);
    }
  }
  for (const structure of structures) for (const point of structureFootprint(structure)) {
    include(point.x, structure.floorY, point.z);
    include(point.x, structure.floorY + structure.heightM + 0.3, point.z);
  }
  for (const person of audience) {
    for (const x of [-person.heightM * 0.25, person.heightM * 0.25]) for (const z of [-0.56, 0.18]) {
      const point = seatedPoint(person, x, 0, z); include(point.x, point.y, point.z);
      include(point.x, person.floorY + person.heightM + (person.selected ? 0.25 : 0.05), point.z);
    }
  }
  return result;
}

function convexHull(points) {
  const sorted = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = list => {
    const result = [];
    for (const point of list) {
      while (result.length >= 2 && turn(result.at(-2), result.at(-1), point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

function pixelBounds(points) {
  if (!points.length) return null;
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}

function structureProjections(structures, basis, viewport, focal, screen = viewport) {
  return structures.map(structure => {
    const footprint = structureFootprint(structure);
    const lower = footprint.map(point => vec(point.x, structure.floorY, point.z));
    const upper = footprint.map(point => vec(point.x, structure.floorY + structure.heightM, point.z));
    const faces = [lower, upper, ...lower.map((point, index) => [point, lower[(index + 1) % lower.length], upper[(index + 1) % upper.length], upper[index]])];
    const polygon = convexHull(faces.flatMap(face => clipNear(face, basis)).map(point => projectCamera(point, viewport, focal)));
    const bounds = pixelBounds(polygon);
    const nearClipped = [...lower, ...upper].some(point => cameraPoint(point, basis).depth < NEAR);
    const safeProject = point => {
      const value = cameraPoint(point, basis);
      return { ...projectCamera({ ...value, depth: Math.max(NEAR, value.depth) }, viewport, focal), depth: value.depth, visible: value.depth >= NEAR };
    };
    const bottom = safeProject(vec(structure.x, structure.floorY, structure.z));
    const top = safeProject(vec(structure.x, structure.floorY + structure.heightM, structure.z));
    const center = safeProject(vec(structure.x, structure.floorY + structure.heightM / 2, structure.z));
    const visible = Boolean(bounds && bounds.x <= screen.x + screen.width && bounds.x + bounds.width >= screen.x && bounds.y <= screen.y + screen.height && bounds.y + bounds.height >= screen.y);
    const inFrame = Boolean(bounds && bounds.x >= screen.x && bounds.x + bounds.width <= screen.x + screen.width && bounds.y >= screen.y && bounds.y + bounds.height <= screen.y + screen.height);
    return { id: structure.id, name: structure.name, type: structure.type, bottom, top, center, heightPx: Math.abs(bottom.y - top.y), bounds, polygon, visible, inFrame, nearClipped, clipped: nearClipped || !inFrame, depth: center.depth, dimensions: { widthM: structure.widthM, depthM: structure.depthM, heightM: structure.heightM, diameterM: structure.diameterM }, floorY: structure.floorY, rotationDeg: structure.rotationDeg };
  });
}

function structureHits(projections) {
  return projections.filter(projection => projection.visible && projection.bounds).map(projection => ({ id: projection.id, type: projection.type, ...projection.bounds, polygon: projection.polygon, depth: projection.depth }));
}

function obstructionData(obstruction, g) {
  if (!obstruction?.enabled) return null;
  return {
    x: finite(obstruction.x, 0),
    z: finite(obstruction.z, -g.stageDepthM / 2),
    widthM: Math.max(0.05, finite(obstruction.widthM, 2.4)),
    depthM: Math.max(0.05, finite(obstruction.depthM, 0.45)),
    heightM: Math.max(0.05, finite(obstruction.heightM, 1.1)),
  };
}

function fitViewport(width, height, aspect) {
  const desired = clamp(finite(aspect, width / height), 0.2, 5);
  let viewportWidth = width;
  let viewportHeight = viewportWidth / desired;
  if (viewportHeight > height) {
    viewportHeight = height;
    viewportWidth = height * desired;
  }
  return { x: (width - viewportWidth) / 2, y: (height - viewportHeight) / 2, width: viewportWidth, height: viewportHeight };
}

function drawItems(ctx, items, basis, viewport, focal, { occluder, drawOrderOffset = 0, dpr = 1 } = {}) {
  // Raised-stage occlusion is evaluated in world space, before projection.
  // A large stage face's average painter depth cannot decide which part of a
  // seated body lies behind it. Keep the surviving fragments and original data.
  if (occluder) items = items.flatMap(item => {
    if (item.type === 'polygon') {
      const fragments = occluder.clipPolygon(item.points, item.vertexLight);
      const clipped = fragments.length !== 1 || fragments[0].points.length !== item.points.length
        || fragments[0].points.some((point, index) => length(sub(point, item.points[index])) > 1e-8);
      return fragments.map(fragment => ({ ...item, ...fragment, stageClipped: clipped }));
    }
    if (item.type === 'line') return occluder.clipLine(item.points).map(points => ({ ...item, points }));
    if (item.type === 'label') return occluder.isPointOccluded(item.position) ? [] : [item];
    if (item.type === 'sphere') {
      const visibility = occluder.classifySphere(item.center, item.radius);
      return visibility === 'hidden' ? [] : [{ ...item, stageClipBoundary: visibility === 'boundary' }];
    }
    return [item];
  });
  const prepared = [];
  for (const item of items) {
    if (item.type === 'polygon') {
      if (item.surfaceNormal && dot(item.surfaceNormal, sub(item.surfaceCenter, basis.position)) >= 0) continue;
      const clipped = clipNear(item.points, basis, item.vertexLight);
      if (clipped.length < 3) continue;
      prepared.push({ ...item, projected: clipped.map((p) => projectCamera(p, viewport, focal)),
        ...(item.vertexLight ? { fillLights: clipped.map(p => p.light) } : {}),
        depth: clipped.reduce((sum, p) => sum + p.depth, 0) / clipped.length });
    } else if (item.type === 'sphere') {
      const projected = project(item.center, basis, viewport, focal);
      if (projected.depth <= item.radius + NEAR) continue;
      prepared.push({ ...item, projected, depth: projected.depth, radiusPx: viewport.orthographicScale !== undefined ? viewport.orthographicScale * item.radius : focal * item.radius / Math.sqrt(projected.depth ** 2 - item.radius ** 2) });
    } else if (item.type === 'line') {
      const a = cameraPoint(item.points[0], basis), b = cameraPoint(item.points[1], basis);
      if (a.depth < NEAR && b.depth < NEAR) continue;
      if ((a.depth < NEAR) !== (b.depth < NEAR)) {
        const near = a.depth < NEAR ? a : b;
        const far = a.depth < NEAR ? b : a;
        const t = (NEAR - near.depth) / (far.depth - near.depth);
        near.x += (far.x - near.x) * t;
        near.y += (far.y - near.y) * t;
        near.depth = NEAR;
      }
      prepared.push({ ...item, projected: [a, b].map((p) => projectCamera(p, viewport, focal)), depth: (a.depth + b.depth) / 2 });
    } else if (item.type === 'label') {
      const projected = project(item.position, basis, viewport, focal);
      if (!projected.visible) continue;
      prepared.push({ ...item, projected, depth: projected.depth });
    }
  }
  prepared.sort((a, b) => b.depth - a.depth);
  for (const [drawOrder, item] of prepared.entries()) {
    item.drawOrder = drawOrder + drawOrderOffset;
    if (item.type === 'polygon') {
      ctx.beginPath();
      item.projected.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.closePath();
      // Strokes must not grow the discarded body fragment back over the stage.
      if (item.stageClipped) { ctx.save(); ctx.clip(); }
      ctx.fillStyle = item.fill;
      if (item.surfaceColor && item.fillLights?.length === item.projected.length) {
        const min = item.fillLights.indexOf(Math.min(...item.fillLights)), max = item.fillLights.indexOf(Math.max(...item.fillLights));
        const a = item.projected[min], b = item.projected[max];
        if (Math.hypot(a.x - b.x, a.y - b.y) > .1) {
          const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, shade(item.surfaceColor, item.fillLights[min]));
          gradient.addColorStop(1, shade(item.surfaceColor, item.fillLights[max]));
          ctx.fillStyle = gradient;
        }
      }
      ctx.fill();
      // Only standing-body surfaces seal their subpixel antialias cracks. The
      // shared audience/chair meshes retain their original drawing behavior.
      if (item.sealSurface) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .8; ctx.stroke(); }
      if (item.stroke) {
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.lineWidth;
        ctx.stroke();
      }
      if (item.stageClipped) ctx.restore();
    } else if (item.type === 'sphere') {
      const radius = item.radiusPx;
      const { x, y } = item.projected;
      if (item.stageClipBoundary) {
        const mask = occluder.sphereVisibleRuns(item.center, item.radius, basis, viewport, focal,
          { x: x - radius - 1, y: y - radius - 1, width: radius * 2 + 2, height: radius * 2 + 2 }, dpr);
        ctx.save(); ctx.beginPath();
        for (const run of mask.runs) ctx.rect(run.x / dpr, run.y / dpr, run.width / dpr, run.height / dpr);
        ctx.clip();
      }
      const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.45, radius * 0.08, x, y, radius);
      gradient.addColorStop(0, shade(item.color, 1.28));
      gradient.addColorStop(0.55, item.color);
      gradient.addColorStop(1, shade(item.color, 0.7));
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fillStyle = gradient;
      ctx.fill();
      if (item.stroke) { ctx.strokeStyle = item.stroke; ctx.lineWidth = item.lineWidth || 1; ctx.stroke(); }
      if (item.stageClipBoundary) ctx.restore();
    } else if (item.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(item.projected[0].x, item.projected[0].y);
      ctx.lineTo(item.projected[1].x, item.projected[1].y);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.lineWidth || 0.6;
      ctx.stroke();
    } else if (item.type === 'label') {
      const { x, y } = item.projected;
      const fontSize = item.fontSize || 11;
      ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (item.background !== false) {
        const width = ctx.measureText(item.text).width + 10, height = fontSize + 7;
        roundedRect(ctx, x - width / 2, y - height / 2, width, height, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.fill();
      }
      ctx.fillStyle = item.color || '#17191c';
      ctx.fillText(item.text, x, y + 0.5);
    }
  }
  return prepared;
}

function projectedSurface(item) {
  if (!(item.depth > 0) || !Number.isFinite(item.depth)) return null;
  if (item.type === 'polygon') return { type: 'polygon', polygon: item.projected, bounds: pixelBounds(item.projected), depth: item.depth, drawOrder: item.drawOrder,
    ...(item.barrierId ? { barrierId: item.barrierId, kind: 'auditorium_barrier' } : {}),
    ...(item.stageSurfaceKind ? { stageSurfaceKind: item.stageSurfaceKind,
      ...(item.stageSurfaceKind === 'side' ? { stageEdgeIndex: item.stageEdgeIndex, stageEdgeRange: item.stageEdgeRange } : {}) } : {}),
    ...(item.actorPart ? { actorPart: item.actorPart } : {}) };
  if (item.type === 'sphere') {
    const { x, y } = item.projected, radius = item.radiusPx;
    return { type: 'circle', x, y, radius, bounds: { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }, depth: item.depth, drawOrder: item.drawOrder };
  }
  return null;
}

function boundsIntersect(a, b) {
  return Boolean(a && b && a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y);
}

function audienceHitsFromDrawn(items, audience, screen) {
  if (!audience.length) return [];
  const byId = new Map(audience.map(person => [person.id, { id: person.id, name: person.name, seat: person.seat, preset: person.preset, selected: person.selected, surfaces: [], screen }]));
  const occluders = [];
  for (const item of items) {
    const surface = projectedSurface(item);
    if (!surface || !boundsIntersect(surface.bounds, screen)) continue;
    const person = byId.get(item.audienceId);
    if (person) person.surfaces.push(surface); else occluders.push(surface);
  }
  const hits = [...byId.values()].filter(hit => hit.surfaces.length).map(hit => {
    const corners = hit.surfaces.flatMap(surface => [{ x: surface.bounds.x, y: surface.bounds.y }, { x: surface.bounds.x + surface.bounds.width, y: surface.bounds.y + surface.bounds.height }]);
    const bounds = pixelBounds(corners);
    return { ...hit, bounds, visible: true, depth: Math.min(...hit.surfaces.map(surface => surface.depth)) };
  });
  // The live array carries one shared occluder list instead of duplicating the
  // same chair/wall meshes in every hit. Picking follows the painter's average
  // surface depth; it is not an exact per-pixel 3D depth buffer.
  Object.defineProperty(hits, 'occluders', { value: occluders });
  return hits;
}

function stageObjectHitsFromDrawn(items, actors, structures, screen) {
  const byId = new Map([
    ...actors.map(person => [`person:${person.id}`, { id: person.id, kind: 'person', type: 'person', name: person.name, selected: person.selected, floorY: person.floorY, heightM: person.heightM, bodyPreset: person.bodyPreset, bodyProfile: person.bodyProfile, surfaces: [], screen }]),
    ...structures.map(structure => [`structure:${structure.id}`, { id: structure.id, kind: 'structure', type: structure.type, name: structure.name, selected: structure.selected, floorY: structure.floorY, heightM: structure.heightM, surfaces: [], screen }]),
  ]);
  const occluders = [];
  for (const item of items) {
    if (item.stageAdornment) continue;
    const surface = projectedSurface(item);
    if (!surface || !boundsIntersect(surface.bounds, screen)) continue;
    const hit = byId.get(`${item.stageObjectKind}:${item.stageObjectId}`);
    if (hit) hit.surfaces.push(surface); else occluders.push(surface);
  }
  const hits = [...byId.values()].filter(hit => hit.surfaces.length).map(hit => ({
    ...hit,
    bounds: pixelBounds(hit.surfaces.flatMap(surface => [
      { x: surface.bounds.x, y: surface.bounds.y },
      { x: surface.bounds.x + surface.bounds.width, y: surface.bounds.y + surface.bounds.height },
    ])),
    visible: true, depth: Math.min(...hit.surfaces.map(surface => surface.depth)),
  }));
  // Surfaces use the renderer's painter depth and draw order. The shared list
  // includes chairs, audience, walls and the optional large obstruction.
  Object.defineProperty(hits, 'occluders', { value: occluders });
  return hits;
}

function stageOutline(g) {
  return g.stagePolygon ?? [
    { x: -g.stageWidthM / 2, z: -g.stageDepthM }, { x: g.stageWidthM / 2, z: -g.stageDepthM },
    { x: g.stageWidthM / 2, z: 0 }, { x: -g.stageWidthM / 2, z: 0 },
  ];
}

function worldBounds(g, seats = createSeatList(g)) {
  const points = [...stageOutline(g), ...(g.roomBoundary || []), ...seats];
  if (!points.length) points.push({ x: 0, z: 0 });
  const xMin = Math.min(...points.map(p => p.x)) - 0.6, xMax = Math.max(...points.map(p => p.x)) + 0.6;
  const zMin = Math.min(...points.map(p => p.z)) - 0.4, zMax = Math.max(...points.map(p => p.z)) + 0.6;
  const yMin = Math.min(0, ...seats.map(s => s.floorY));
  const yMax = Math.max(g.stageHeightM + 2, ...seats.map(s => s.floorY + 1.2));
  return { xMin, xMax, zMin, zMax, yMin, yMax };
}

// Official row keys may identify booking sections spanning several physical
// rows. Keep seat identity separate from the rows used to inspect the geometry.
const physicalRowKey = seat => seat?.physicalRow ?? seat?.row;
const physicalRowLabel = seat => String(seat.physicalRowLabel ?? seat.rowLabel ?? physicalRowKey(seat));

function physicalRows(seats) {
  const rows = new Map();
  for (const seat of seats) {
    const row = physicalRowKey(seat);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(seat);
  }
  return [...rows].sort(([a], [b]) => a - b);
}

// Row names are screen annotations, not world geometry. Pack their measured
// cards after the scene pass so diagonal projections cannot merge the text.
function drawOrbitRowLabels(ctx, rows, selected, basis, viewport, focal, width, height, drawn) {
  const floorName = seat => {
    const value = seat.floorLabel ?? seat.floor ?? seat.level ?? seat.floorId;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };
  const fontSize = width < 500 ? 10 : 11, padding = 7, gap = 3, top = 33;
  const reserved = drawn.filter(item => item.type === 'label').map(item => {
    ctx.font = `500 ${item.fontSize || 11}px system-ui, -apple-system, sans-serif`;
    return { x: item.projected.x - (ctx.measureText(item.text).width + 12) / 2,
      y: item.projected.y - ((item.fontSize || 11) + 9) / 2,
      width: ctx.measureText(item.text).width + 12, height: (item.fontSize || 11) + 9 };
  });
  const candidates = rows.flatMap(([row, seats]) => {
    const floors = new Map();
    for (const seat of seats) {
      const floor = floorName(seat);
      if (!floors.has(floor)) floors.set(floor, []);
      floors.get(floor).push(seat);
    }
    return [...floors].map(([floorLabel, inFloor]) => {
      const left = inFloor.reduce((a, b) => a.x < b.x ? a : b);
      const anchor = project(vec(left.x - 0.6, left.floorY + 0.55, left.z), basis, viewport, focal);
      const rowLabel = physicalRowLabel(left), label = floorLabel ? `${floorLabel} · ${rowLabel}` : rowLabel;
      const selectedRow = inFloor.some(seat => seat.row === selected?.row && seat.number === selected?.number);
      ctx.font = `${selectedRow ? 700 : 500} ${fontSize}px system-ui, -apple-system, sans-serif`;
      return { rowKey: floorLabel ? `${floorLabel}::${String(row)}` : String(row), row, rowLabel, floorLabel, label,
        officialRowLabels: [...new Set(inFloor.map(seat => String(seat.rowLabel ?? seat.row)))],
        selected: selectedRow, anchor: { x: anchor.x, y: anchor.y }, fontSize,
        width: Math.min(width - padding * 2, ctx.measureText(label).width + 10), height: fontSize + 6 };
    });
  }).filter(item => Number.isFinite(item.anchor.x) && Number.isFinite(item.anchor.y));
  const placed = [], occupied = [...reserved];
  const overlaps = (a, b) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || a.anchor.y - b.anchor.y || a.rowKey.localeCompare(b.rowKey));
  for (const item of candidates) {
    const maxX = Math.max(padding, width - padding - item.width), maxY = Math.max(top, height - padding - item.height);
    const preferredX = item.anchor.x <= width / 2 ? item.anchor.x - item.width - 8 : item.anchor.x + 8;
    const xs = [preferredX, item.anchor.x - item.width / 2, padding, maxX,
      ...occupied.flatMap(box => [box.x - item.width - gap, box.x + box.width + gap])].map(x => clamp(x, padding, maxX));
    const ys = [item.anchor.y - item.height / 2, top, maxY,
      ...occupied.flatMap(box => [box.y - item.height - gap, box.y + box.height + gap])].map(y => clamp(y, top, maxY));
    let best = null, cost = Infinity;
    for (const x of xs) for (const y of ys) {
      const box = { x, y, width: item.width, height: item.height };
      if (occupied.some(other => overlaps(box, other))) continue;
      const next = Math.hypot(x + item.width / 2 - item.anchor.x, y + item.height / 2 - item.anchor.y)
        + Math.abs(x - clamp(preferredX, padding, maxX)) * .12;
      if (next < cost) { best = box; cost = next; }
    }
    // Normal supported canvases have room for all rows. On an exceptionally
    // small canvas retain the name and expose the constraint rather than
    // silently dropping row identity.
    const bounds = best || { x: padding, y: top, width: item.width, height: item.height };
    const start = { x: clamp(item.anchor.x, 1, width - 1), y: clamp(item.anchor.y, 1, height - 1) };
    const end = { x: clamp(start.x, bounds.x, bounds.x + bounds.width), y: clamp(start.y, bounds.y, bounds.y + bounds.height) };
    const annotation = { rowKey: item.rowKey, row: item.row, rowLabel: item.rowLabel, officialRowLabels: item.officialRowLabels,
      floorLabel: item.floorLabel, label: item.label, selected: item.selected, anchor: item.anchor, bounds,
      leader: [start, end], fontSize, suppressed: false, crowded: !best };
    occupied.push(bounds); placed.push(annotation);
  }
  for (const item of placed) {
    ctx.beginPath(); ctx.moveTo(item.leader[0].x, item.leader[0].y); ctx.lineTo(item.leader[1].x, item.leader[1].y);
    ctx.strokeStyle = item.selected ? '#343a42' : '#7b8591'; ctx.lineWidth = item.selected ? 1.1 : .9; ctx.stroke();
  }
  for (const item of placed) {
    const box = item.bounds;
    roundedRect(ctx, box.x, box.y, box.width, box.height, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fill();
    ctx.strokeStyle = item.selected ? '#343a42' : '#c5cbd3'; ctx.lineWidth = item.selected ? 1.2 : .6; ctx.stroke();
    ctx.font = `${item.selected ? 700 : 500} ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = item.selected ? '#17191c' : '#343a42';
    ctx.fillText(item.label, box.x + box.width / 2, box.y + box.height / 2 + .5);
  }
  return placed;
}

function platforms(g, seats = createSeatList(g)) {
  if (g.rowPlatforms) return g.rowPlatforms;
  const bounds = worldBounds(g, seats);
  const firstRiser = g.firstRowDistanceM - g.rowSpacingM * 0.44;
  // Custom seat geometry without surveyed platform footprints may display
  // chairs, but receives no invented platform geometry.
  if (g.seats) return [];
  return Array.from({ length: g.rowCount }, (_, index) => ({
    row: index + 1, y: index * g.rowRiseM,
    xMin: bounds.xMin, xMax: bounds.xMax,
    zStart: firstRiser + index * g.rowSpacingM,
    zEnd: firstRiser + (index + 1) * g.rowSpacingM,
  }));
}

function addPrism(items, outline, y, baseY, color, edge) {
  if (outline.length < 3) return;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if (Math.abs(y - baseY) > 0.0001) addPolygon(items, [vec(a.x, baseY, a.z), vec(b.x, baseY, b.z), vec(b.x, y, b.z), vec(a.x, y, a.z)], shade(color, 0.78 + (i % 3) * 0.08), edge);
  }
  addPolygon(items, outline.map(p => vec(p.x, y, p.z)), shade(color, 1.1), edge);
}

// Half-open edge tests avoid counting a polygon vertex twice. Pairing sorted
// crossings gives segments wholly inside even a concave stage footprint.
function polygonCrossings(outline, axis, value) {
  const other = axis === 'x' ? 'z' : 'x', crossings = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if ((a[axis] <= value && b[axis] > value) || (b[axis] <= value && a[axis] > value)) {
      crossings.push(a[other] + (b[other] - a[other]) * (value - a[axis]) / (b[axis] - a[axis]));
    }
  }
  return crossings.sort((a, b) => a - b);
}

function addStageGrid(items, g) {
  const bounds = stageBounds(g), outline = stageOutline(g);
  if (!bounds) return;
  const step = Math.max(1, Math.ceil(Math.max(bounds.widthM, bounds.depthM) / 60));
  for (const axis of ['x', 'z']) {
    const min = bounds[`${axis}Min`], max = bounds[`${axis}Max`];
    for (let value = Math.ceil(min / step) * step; value < max; value += step) {
      const crossings = polygonCrossings(outline, axis, value);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const points = [crossings[i], crossings[i + 1]].map(other => axis === 'x' ? vec(value, g.stageHeightM + 0.004, other) : vec(other, g.stageHeightM + 0.004, value));
        items.push({ type: 'line', points, color: 'rgba(50,56,64,0.20)', stageDecoration: true });
      }
    }
  }
}

function addGround(items, g, showGrid, seats = createSeatList(g), enclosure) {
  const bounds = worldBounds(g, seats), baseY = Math.min(0, bounds.yMin);
  const floorOutline = g.roomBoundary?.length >= 3 ? g.roomBoundary : [
    { x: bounds.xMin, z: 0 }, { x: bounds.xMax, z: 0 },
    { x: bounds.xMax, z: bounds.zMax }, { x: bounds.xMin, z: bounds.zMax },
  ];
  addPolygon(items, floorOutline.map(p => vec(p.x, baseY, p.z)), SCENE_COLORS.hallFloor, '#7a838e');
  items.at(-1).groundBase = true;
  for (const platform of platforms(g, seats)) {
    const start = items.length;
    addPrism(items, [
      { x: platform.xMin, z: platform.zStart }, { x: platform.xMax, z: platform.zStart },
      { x: platform.xMax, z: platform.zEnd }, { x: platform.xMin, z: platform.zEnd },
    ], platform.y, baseY, platform.row % 2 ? '#bbc1c9' : '#c7cbd1', '#7a838e');
    // A zero-height platform is a marking on the same base plane, not a
    // nearer raised solid. Average-depth sorting can otherwise paint its
    // far edge over a person's legs. Retain its original fill and outline.
    if (platform.y === baseY) for (let i = start; i < items.length; i++) items[i].basePlanePlatform = true;
  }
  const outline = stageOutline(g);
  const stageStart = items.length;
  addPrism(items, outline, g.stageHeightM, baseY, SCENE_COLORS.stageFloor, SCENE_COLORS.stageEdge);
  for (let index = stageStart; index < items.length; index += 1) {
    items[index].stageSurfaceKind = index === items.length - 1 ? 'top' : 'side';
    if (items[index].stageSurfaceKind === 'side') {
      items[index].stageEdgeIndex = index - stageStart;
      items[index].stageEdgeRange = [0, 1];
    }
  }
  if (showGrid) addStageGrid(items, g);
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const front = enclosure ? enclosure.openFrontEdges.includes(i) : Math.max(a.z, b.z) >= -0.015 && Math.min(a.z, b.z) > -g.stageDepthM * 0.2;
    items.push({ type: 'line', points: [vec(a.x, g.stageHeightM + 0.008, a.z), vec(b.x, g.stageHeightM + 0.008, b.z)], color: front ? SCENE_COLORS.stageFront : SCENE_COLORS.stageEdge, lineWidth: front ? 2.4 : 0.8, stageDecoration: true });
  }
}

function drawStageAndScene(ctx, ground, items, basis, viewport, focal, dpr) {
  const stageFaces = ground.filter(item => item.stageSurfaceKind);
  const baseY = ground.find(item => item.groundBase)?.points[0]?.y;
  // Explicit below-floor structures retain the previous sorting behavior;
  // this correction only establishes that the base plane is behind geometry
  // wholly on/above it. Raised platforms keep their existing depth sorting.
  const belowBase = Number.isFinite(baseY) && items.some(item => item.points?.some(point => point.y < baseY)
    || item.type === 'sphere' && item.center.y - item.radius < baseY);
  drawItems(ctx, ground.filter(item => item.groundBase), basis, viewport, focal);
  if (!belowBase) drawItems(ctx, ground.filter(item => item.basePlanePlatform), basis, viewport, focal);
  const stage = drawItems(ctx, ground.filter(item => item.stageSurfaceKind || item.stageDecoration), basis, viewport, focal);
  const occluder = createStageOccluder(stageFaces, basis.position);
  const foreground = ground.filter(item => !item.groundBase && (!item.basePlanePlatform || belowBase) && !item.stageSurfaceKind && !item.stageDecoration);
  return [...stage, ...drawItems(ctx, [...foreground, ...items], basis, viewport, focal,
    { occluder, dpr, drawOrderOffset: stage.length })];
}

function stageEnclosureData(geometry, options) {
  return { ...buildStageEnclosure(geometry, { heightM: options?.heightM, sides: options?.sides, enabled: options?.enabled }), enabled: options?.enabled === true };
}

function displayWalls(enclosure, g, mode, position) {
  if (!enclosure.enabled) return [];
  const bounds = stageBounds(g), centerX = bounds ? (bounds.xMin + bounds.xMax) / 2 : 0, centerZ = bounds ? (bounds.zMin + bounds.zMax) / 2 : 0;
  return enclosure.walls.map(wall => {
    // Only the explicitly requested side section is cut open. Orbiting the
    // complete 3D model never shortens an enabled wall behind the user's back.
    const nearSide = mode === 'side' && (wall.side === 'left' ? position.x < centerX : wall.side === 'right' ? position.x > centerX : position.z < centerZ);
    const displayHeightM = nearSide ? Math.min(wall.heightM, mode === 'side' ? 0.22 : 0.45) : wall.heightM;
    return { ...wall, displayHeightM, cutaway: nearSide, source: enclosure.source };
  });
}

function wallPoints(wall) {
  return [vec(wall.a.x, wall.floorY, wall.a.z), vec(wall.b.x, wall.floorY, wall.b.z), vec(wall.b.x, wall.floorY + wall.displayHeightM, wall.b.z), vec(wall.a.x, wall.floorY + wall.displayHeightM, wall.a.z)];
}

function addStageWalls(items, walls, compact = false) {
  for (const wall of walls) {
    addPolygon(items, wallPoints(wall), wall.side === 'back' ? SCENE_COLORS.backWall : SCENE_COLORS.sideWall, SCENE_COLORS.wallEdge, 0.85);
  }
  for (const side of ['back', 'left', 'right']) {
    const candidates = walls.filter(wall => wall.side === side).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z) - Math.hypot(a.b.x - a.a.x, a.b.z - a.a.z));
    const wall = candidates[0]; if (!wall) continue;
    items.push({ type: 'label', position: vec((wall.a.x + wall.b.x) / 2, wall.floorY + (wall.cutaway ? wall.displayHeightM + 0.13 : wall.displayHeightM * 0.68), (wall.a.z + wall.b.z) / 2), text: `${side === 'back' ? '뒤벽' : side === 'left' ? '좌벽' : '우벽'}${wall.cutaway ? ' · 절개' : ''}`, color: '#343a42', fontSize: compact ? 8 : 10 });
  }
}

function addStageFloorLabel(items, g) {
  const bounds = stageBounds(g); if (!bounds) return;
  items.push({ type: 'label', position: vec(bounds.xMin + bounds.widthM * 0.20, g.stageHeightM + 0.024, bounds.zMax - bounds.depthM * 0.20), text: '무대 바닥', color: '#20242a', fontSize: 10 });
}

function wallProjections(walls, basis, viewport, focal, screen = viewport) {
  return walls.map(wall => {
    const vertices = wallPoints(wall), clipped = clipNear(vertices, basis), polygon = clipped.map(point => projectCamera(point, viewport, focal)), bounds = pixelBounds(polygon);
    const visible = Boolean(bounds && bounds.x <= screen.x + screen.width && bounds.x + bounds.width >= screen.x && bounds.y <= screen.y + screen.height && bounds.y + bounds.height >= screen.y);
    const inFrame = Boolean(bounds && bounds.x >= screen.x && bounds.x + bounds.width <= screen.x + screen.width && bounds.y >= screen.y && bounds.y + bounds.height <= screen.y + screen.height);
    return { ...wall, polygon, bounds, visible, inFrame, nearClipped: vertices.some(point => cameraPoint(point, basis).depth < NEAR) };
  });
}

function activeAuditoriumBarriers(geometry, enabled) {
  return enabled === true ? getAuditoriumBarriers(geometry) : [];
}

function addAuditoriumBarriers(items, barriers) {
  for (const barrier of barriers) {
    const start = items.length;
    addRotatedBox(items, barrier, barrier.floorY, 0, barrier.widthM, barrier.heightM, barrier.depthM,
      barrier.color || SCENE_COLORS.auditoriumBarrier, SCENE_COLORS.auditoriumBarrierEdge);
    for (let index = start; index < items.length; index += 1) items[index].barrierId = barrier.id;
  }
}

function barrierProjections(barriers, drawn, basis, viewport, focal, screen = viewport) {
  const projections = structureProjections(barriers.map(barrier => ({ ...barrier, type: 'box' })), basis, viewport, focal, screen);
  return barriers.map((barrier, index) => {
    const surfaces = drawn.filter(item => item.barrierId === barrier.id).map(projectedSurface).filter(Boolean);
    return { ...barrier, ...projections[index], kind: 'auditorium_barrier', surfaces, renderedSurfaceCount: surfaces.length };
  });
}

function addRotatedBox(items, seat, y, localZ, width, height, depth, color, edge) {
  const parts = [];
  addBox(parts, 0, y, localZ, width, height, depth, color, edge);
  const angle = finite(seat.rotationDeg, 0) * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  parts.forEach(part => {
    part.points = part.points.map(p => vec(seat.x + p.x * cos + p.z * sin, p.y, seat.z - p.x * sin + p.z * cos));
    items.push(part);
  });
}

function addChair(items, seat, g, selected = false) {
  const width = Math.min(g.seatSpacingM * 0.74, 0.45);
  const edge = selected ? '#ffffff' : '#69737f';
  addRotatedBox(items, seat, seat.floorY + 0.34, 0, width, 0.12, 0.38, selected ? '#17191c' : '#727d8b', edge);
  addRotatedBox(items, seat, seat.floorY + 0.42, 0.15, width, 0.35, 0.085, selected ? '#303741' : '#87919e', edge);
}

function addScenePeople(items, people, obstruction, g, view) {
  const actors = people.map((person, index) => personData(person, index, g));
  actors.forEach(person => {
    const heightPx = view ? Math.abs(
      projectSafe(vec(person.x, person.floorY, person.z), view.basis, view.viewport, view.focal).y
      - projectSafe(vec(person.x, person.floorY + person.heightM, person.z), view.basis, view.viewport, view.focal).y,
    ) : Infinity;
    // Small full-room figures need fewer curved faces than a close-up. Detail
    // follows their actual CSS-pixel height, preserving the same body dimensions.
    const detail = people.length >= 16 ? { crowd: true } : heightPx < 90 ? { segments: 16, capSteps: 4 } : heightPx < 180 ? { segments: 20, capSteps: 5 } : undefined;
    if(person.pose==='chair') {
      const chair={...person,rotationDeg:person.facingDeg},h=person.heightM;
      addRotatedBox(items,chair,person.floorY+.245*h,0,.29*h,.025*h,.26*h,'#b5a78e','#736955');
      addRotatedBox(items,chair,person.floorY+.27*h,-.12*h,.29*h,.24*h,.025*h,'#b5a78e','#736955');
      for(const x of [-.12,.12])for(const z of [-.10,.10]){
        const a=person.facingDeg*Math.PI/180;
        addBox(items,person.x+(x*Math.cos(a)+z*Math.sin(a))*h,person.floorY,person.z+(-x*Math.sin(a)+z*Math.cos(a))*h,.025*h,.245*h,.025*h,'#8f826e','#736955');
      }
    }
    addPerson(items, person, detail);
  });
  const block = obstructionData(obstruction, g);
  if (block) {
    addBox(items, block.x, g.stageHeightM, block.z, block.widthM, block.heightM, block.depthM, '#ba8760', '#e0b68c');
    items.push({ type: 'label', position: vec(block.x, g.stageHeightM + block.heightM + 0.18, block.z), text: '가림 요소', color: '#343a42' });
  }
  return actors;
}

function personProjections(actors, position, basis, viewport, focal, screen = viewport) {
  return actors.map(person => {
    const feet = projectSafe(vec(person.x, person.floorY, person.z), basis, viewport, focal);
    const meshBounds = person.meshBounds;
    const top = projectSafe(vec(person.x, meshBounds?.yMax ?? person.floorY + person.heightM, person.z), basis, viewport, focal);
    const body = structureProjections([{ ...person, type: 'box', floorY:meshBounds?.yMin ?? person.floorY, heightM:meshBounds ? meshBounds.yMax-meshBounds.yMin : person.heightM,
      x: meshBounds ? (meshBounds.xMin + meshBounds.xMax) / 2 : person.x,
      z: meshBounds ? (meshBounds.zMin + meshBounds.zMax) / 2 : person.z,
      widthM: meshBounds ? meshBounds.xMax - meshBounds.xMin : person.heightM * .51,
      depthM: meshBounds ? meshBounds.zMax - meshBounds.zMin : person.heightM * .28,
      rotationDeg: meshBounds ? 0 : person.facingDeg }], basis, viewport, focal, screen)[0];
    const frontVisible = feet.visible && top.visible;
    return { id: person.id, feet, top, heightPx: Math.abs(feet.y - top.y), distanceM: length(sub(vec(person.x, person.floorY + person.heightM / 2, person.z), position)), visible: frontVisible, frontVisible, inFrame: body.inFrame, intersectsViewport: body.visible, bounds: body.bounds, worldBounds: meshBounds,
      bodyPreset: person.bodyPreset, bodyProfile: person.bodyProfile, nearClipped: body.nearClipped, facingDeg: person.facingDeg };
  });
}

function drawError(ctx, width, height, message) {
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, width, height);
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#565d66'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(message, width / 2, height / 2);
}

/** Render once. All positions use metres; returned hit data uses CSS pixels. */
export function renderSeatView(canvas, { geometry = {}, seat = {}, camera = {}, people = [], audience = [], audienceSelectedId, structures = [], obstruction, stageEnclosure, auditoriumBarriersEnabled = true, showGrid = true } = {}) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return { error: '2D canvas unavailable', personProjections: [], audienceProjections: [], audienceHits: [], structureProjections: [], structureHits: [], barrierProjections: [], stageObjectHits: [], editProjection: null };
  const { ctx, width, height, dpr } = prepared, g = normalizeGeometry(geometry);
  const position = seatPosition(g, seat, finite(camera.eyeHeightM, g.eyeHeightM));
  if (!position || !stageBounds(g)) {
    const error = !position ? '선택한 좌석이 모델에 없습니다.' : '무대 윤곽을 확인할 수 없습니다.';
    drawError(ctx, width, height, error);
    return { error, cameraPosition: null, personProjections: [], audienceProjections: [], audienceHits: [], structureProjections: [], structureHits: [], barrierProjections: [], stageObjectHits: [], editProjection: null };
  }
  const bounds = stageBounds(g);
  const target = vec(finite(camera.aimX, (bounds.xMin + bounds.xMax) / 2), finite(camera.aimY, g.stageHeightM + 0.9), finite(camera.aimZ, (bounds.zMin + bounds.zMax) / 2));
  const basis = cameraBasis(position, target);
  const horizontalFovDeg = clamp(finite(camera.horizontalFovDeg, 65), 2, 150);
  const viewport = fitViewport(width, height, camera.aspectRatio);
  const focal = viewport.width / (2 * Math.tan(horizontalFovDeg * Math.PI / 360));
  const verticalFovDeg = 2 * Math.atan(viewport.height / (2 * focal)) * 180 / Math.PI;
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.beginPath(); ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height); ctx.clip();
  const gradient = ctx.createLinearGradient(0, viewport.y, 0, viewport.y + viewport.height);
  gradient.addColorStop(0, '#fafbfc'); gradient.addColorStop(0.65, '#edf0f3'); gradient.addColorStop(1, '#e3e7eb');
  ctx.fillStyle = gradient; ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  const seats = createSeatList(g), ground = [];
  const enclosure = stageEnclosureData(geometry, stageEnclosure), walls = displayWalls(enclosure, g, 'seat', position);
  const barriers = activeAuditoriumBarriers(g, auditoriumBarriersEnabled);
  addGround(ground, g, showGrid, seats, enclosure);
  const items = [];
  addStageWalls(items, walls, width < 400);
  addAuditoriumBarriers(items, barriers);
  addStageFloorLabel(items, g);
  const visibleChairs = [];
  for (const s of seats) {
    if (s.row === position.row && s.number === position.number) continue;
    if (!sphereIntersectsView(vec(s.x, s.floorY + 0.55, s.z), 0.50, basis, viewport, focal)) continue;
    addChair(items, s, g);
    visibleChairs.push({ row: s.row, number: s.number });
  }
  const actors = addScenePeople(items, people, obstruction, g, { basis, viewport, focal });
  const objects = normalizedStructures(structures, g);
  addStructures(items, objects, width < 400);
  const spectators = normalizedAudience(audience, g, audienceSelectedId).filter(person => person.seat?.row !== position.row || person.seat?.number !== position.number);
  addAudience(items, spectators, { basis, viewport, focal });
  const drawn = drawStageAndScene(ctx, ground, items, basis, viewport, focal, dpr);
  ctx.restore();
  ctx.strokeStyle = '#78828e'; ctx.lineWidth = 1;
  ctx.strokeRect(viewport.x + 0.5, viewport.y + 0.5, Math.max(0, viewport.width - 1), Math.max(0, viewport.height - 1));
  const centerX = viewport.x + viewport.width / 2, centerY = viewport.y + viewport.height / 2;
  ctx.strokeStyle = 'rgba(58,65,74,0.30)'; ctx.beginPath();
  ctx.moveTo(centerX - 6, centerY); ctx.lineTo(centerX + 6, centerY);
  ctx.moveTo(centerX, centerY - 6); ctx.lineTo(centerX, centerY + 6); ctx.stroke();
  const projections = structureProjections(objects, basis, viewport, focal);
  return { cameraPosition: position, cameraTarget: target, horizontalFovDeg, verticalFovDeg, viewport, editProjection: { kind: 'perspective', basis, viewport, focal, screen: viewport, near: NEAR }, stageObjectHits: stageObjectHitsFromDrawn(drawn, actors, objects, viewport), stageBounds: bounds, stageEnclosure: enclosure, wallProjections: wallProjections(walls, basis, viewport, focal), barrierProjections: barrierProjections(barriers, drawn, basis, viewport, focal), visibleChairs, personProjections: personProjections(actors, position, basis, viewport, focal), audienceProjections: audienceProjections(spectators, basis, viewport, focal), audienceHits: audienceHitsFromDrawn(drawn, spectators, viewport), structureProjections: projections, structureHits: structureHits(projections) };
}

function overviewLayout(width, height, geometry) {
  const g = normalizeGeometry(geometry), seats = createSeatList(g), bounds = worldBounds(g, seats);
  const marginX = width < 380 ? 26 : 34, marginTop = 21, marginBottom = 35;
  const scale = Math.max(0.1, Math.min((width - marginX * 2) / (bounds.xMax - bounds.xMin), (height - marginTop - marginBottom) / (bounds.zMax - bounds.zMin)));
  const originX = (width - (bounds.xMax - bounds.xMin) * scale) / 2 - bounds.xMin * scale;
  const originY = marginTop + (height - marginTop - marginBottom - (bounds.zMax - bounds.zMin) * scale) / 2 - bounds.zMin * scale;
  const map = (x, z) => ({ x: originX + x * scale, y: originY + z * scale });
  const seatSize = Math.max(3, Math.min(g.seatSpacingM * scale * 0.72, g.rowSpacingM * scale * 0.61, 21));
  const seatHits = seats.map(seat => ({ ...seat, ...map(seat.x, seat.z), radius: Math.max(4, seatSize * 0.65) }));
  return { g, bounds, scale, map, seatSize, seatHits };
}

function outlinePath(ctx, outline, map) {
  ctx.beginPath();
  outline.forEach((point, index) => {
    const p = map(point.x, point.z);
    if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

/** onSeatPick is intentionally not bound: the caller owns pointer events. */
export function renderOverview(canvas, { geometry = {}, seat = {}, people = [], audience = [], audienceSelectedId, structures = [], obstruction, stageEnclosure, auditoriumBarriersEnabled = true } = {}) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return { seatHits: [], audienceProjections: [], audienceHits: [], structureProjections: [], structureHits: [], barrierProjections: [], stageObjectHits: [], editProjection: null, error: '2D canvas unavailable' };
  const { ctx, width, height } = prepared;
  const { g, scale, map, seatSize, seatHits } = overviewLayout(width, height, geometry);
  const selected = seatPosition(g, seat), outline = stageOutline(g), bounds = stageBounds(g);
  const enclosure = stageEnclosureData(geometry, stageEnclosure);
  const barriers = activeAuditoriumBarriers(g, auditoriumBarriersEnabled);
  const compact = width < 340;
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, width, height);
  if (g.roomBoundary?.length >= 3) {
    outlinePath(ctx, g.roomBoundary, map); ctx.fillStyle = '#e5e8ec'; ctx.fill();
    ctx.strokeStyle = '#858e99'; ctx.lineWidth = 1; ctx.stroke();
  }
  if (bounds) {
    outlinePath(ctx, outline, map); ctx.fillStyle = SCENE_COLORS.stageFloor; ctx.fill(); ctx.strokeStyle = SCENE_COLORS.stageEdge; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); outlinePath(ctx, outline, map); ctx.clip(); ctx.strokeStyle = 'rgba(46,54,65,0.15)'; ctx.lineWidth = 0.6;
    const step = Math.max(1, Math.ceil(Math.max(bounds.widthM, bounds.depthM) / 60));
    for (let x = Math.ceil(bounds.xMin / step) * step; x < bounds.xMax; x += step) {
      const a = map(x, bounds.zMin), b = map(x, bounds.zMax);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let z = Math.ceil(bounds.zMin / step) * step; z < bounds.zMax; z += step) {
      const a = map(bounds.xMin, z), b = map(bounds.xMax, z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
    const center = map((bounds.xMin + bounds.xMax) / 2, bounds.zMin + bounds.depthM * 0.25);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#252b33';
    ctx.font = '600 10px system-ui, -apple-system, sans-serif';
    ctx.fillText(compact ? '무대 바닥' : `무대 바닥 · 윤곽 ${bounds.widthM.toFixed(1)} × ${bounds.depthM.toFixed(1)} m`, center.x, center.y);
    if (!compact) {
      const front = map(0, 0); ctx.fillStyle = '#252b33'; ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillText('무대 앞 기준', front.x, front.y - 8);
    }
  }
  const planWalls = enclosure.enabled ? enclosure.walls.map(wall => {
    const a = map(wall.a.x, wall.a.z), b = map(wall.b.x, wall.b.z), polygon = [a, b];
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = wall.side === 'back' ? SCENE_COLORS.backWall : SCENE_COLORS.sideWall; ctx.lineWidth = compact ? 3 : 4; ctx.stroke();
    return { ...wall, source: enclosure.source, projection: 'plan', displayHeightM: wall.heightM, cutaway: false, polygon, bounds: pixelBounds(polygon), visible: true, inFrame: true, nearClipped: false };
  }) : [];
  for (const opening of enclosure.frontOpenings) {
    const a = map(opening.a.x, opening.a.z), b = map(opening.b.x, opening.b.z);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = SCENE_COLORS.stageFront; ctx.lineWidth = 2; ctx.stroke();
  }
  for (const side of ['back', 'left', 'right']) {
    const wall = planWalls.filter(wall => wall.side === side).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z) - Math.hypot(a.b.x - a.a.x, a.b.z - a.a.z))[0];
    if (!wall) continue;
    const p = map((wall.a.x + wall.b.x) / 2, (wall.a.z + wall.b.z) / 2);
    ctx.font = `${compact ? 8 : 9}px system-ui, -apple-system, sans-serif`; ctx.fillStyle = '#343a42'; ctx.textBaseline = 'middle';
    ctx.textAlign = side === 'left' ? 'right' : side === 'right' ? 'left' : 'center';
    ctx.fillText(side === 'back' ? '뒤벽' : side === 'left' ? '좌벽' : '우벽', p.x + (side === 'left' ? -5 : side === 'right' ? 5 : 0), p.y + (side === 'back' ? -7 : 0));
  }
  const block = obstructionData(obstruction, g);
  if (block) {
    const p = map(block.x - block.widthM / 2, block.z - block.depthM / 2);
    roundedRect(ctx, p.x, p.y, block.widthM * scale, Math.max(4, block.depthM * scale), 3);
    ctx.fillStyle = '#ba8760'; ctx.fill(); ctx.strokeStyle = '#e5b98c'; ctx.stroke();
  }
  const objects = normalizedStructures(structures, g);
  const projections = objects.map(structure => {
    const polygon = structureFootprint(structure).map(point => map(point.x, point.z));
    ctx.beginPath(); polygon.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)); ctx.closePath();
    ctx.fillStyle = shade(structure.color, 0.9); ctx.fill();
    ctx.strokeStyle = structure.selected ? '#17191c' : shade(structure.color, 1.35); ctx.lineWidth = structure.selected ? 1.4 : 0.7; ctx.stroke();
    const pixel = pixelBounds(polygon), center = map(structure.x, structure.z);
    if (!compact && (structure.selected || objects.length <= 4)) {
      ctx.font = '10px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = structure.selected ? '#17191c' : '#343a42';
      ctx.fillText(structure.name, center.x, pixel.y - 8);
    }
    const visible = pixel.x <= width && pixel.x + pixel.width >= 0 && pixel.y <= height && pixel.y + pixel.height >= 0;
    const inFrame = pixel.x >= 0 && pixel.x + pixel.width <= width && pixel.y >= 0 && pixel.y + pixel.height <= height;
    return { id: structure.id, name: structure.name, type: structure.type, projection: 'plan', center, bottom: center, top: center, heightPx: 0, bounds: pixel, polygon, visible, inFrame, nearClipped: false, clipped: !inFrame, depth: 0, dimensions: { widthM: structure.widthM, depthM: structure.depthM, heightM: structure.heightM, diameterM: structure.diameterM }, floorY: structure.floorY, rotationDeg: structure.rotationDeg };
  });
  const actors = people.map((person, index) => personData(person, index, g));
  const planPersonHits = [];
  const screen = { x: 0, y: 0, width, height };
  actors.forEach((person, index) => {
    const p = map(person.x, person.z), radius = clamp(scale * 0.17, 3, 8);
    const angle = person.facingDeg * Math.PI / 180, dx = Math.sin(angle), dy = Math.cos(angle), arrowLength = radius + 7;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dx * arrowLength, p.y + dy * arrowLength);
    ctx.strokeStyle = '#17191c'; ctx.lineWidth = 1.3; ctx.stroke();
    const tip = { x: p.x + dx * arrowLength, y: p.y + dy * arrowLength }, base = { x: p.x + dx * (arrowLength - 4), y: p.y + dy * (arrowLength - 4) };
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(base.x + dy * 2.3, base.y - dx * 2.3); ctx.lineTo(base.x - dy * 2.3, base.y + dx * 2.3); ctx.closePath(); ctx.fillStyle = '#17191c'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 2, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.90)'; ctx.fill();
    if (person.selected) { ctx.strokeStyle = '#17191c'; ctx.lineWidth = 1.2; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU); ctx.fillStyle = person.color; ctx.fill();
    if (radius >= 4) { ctx.font = '700 8px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#17191c'; ctx.fillText(String(index + 1), p.x, p.y + 0.5); }
    const bounds = { x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2 };
    if (boundsIntersect(bounds, screen)) planPersonHits.push({
      id: person.id, kind: 'person', type: 'person', name: person.name, selected: person.selected,
      floorY: person.floorY, heightM: person.heightM, center: p, bounds, screen, visible: true, depth: 1,
      surfaces: [{ type: 'circle', x: p.x, y: p.y, radius, bounds, depth: 1, drawOrder: objects.length + index }],
    });
  });
  const planBarriers = barriers.map((barrier, index) => {
    const polygon = structureFootprint({ ...barrier, type: 'box' }).map(point => map(point.x, point.z));
    const bounds = pixelBounds(polygon), center = map(barrier.x, barrier.z);
    ctx.beginPath(); polygon.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
    ctx.fillStyle = shade(barrier.color || SCENE_COLORS.auditoriumBarrier, 1.12); ctx.fill();
    ctx.strokeStyle = SCENE_COLORS.auditoriumBarrierEdge; ctx.lineWidth = 0.7; ctx.stroke();
    const visible = boundsIntersect(bounds, screen);
    const inFrame = bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height;
    const surfaces = visible ? [{ type: 'polygon', polygon, bounds, depth: 0.9, drawOrder: objects.length + actors.length + index, barrierId: barrier.id, kind: 'auditorium_barrier' }] : [];
    return { ...barrier, kind: 'auditorium_barrier', type: 'box', projection: 'plan', polygon, bounds, center, bottom: center, top: center,
      heightPx: 0, dimensions: { widthM: barrier.widthM, depthM: barrier.depthM, heightM: barrier.heightM },
      visible, inFrame, nearClipped: false, clipped: !inFrame, depth: 0.9, surfaces, renderedSurfaceCount: surfaces.length };
  });
  const selectedRow = physicalRowKey(selected);
  for (const [row, seatsInRow] of physicalRows(seatHits)) {
    const left = seatsInRow.reduce((a, b) => a.x < b.x ? a : b), right = seatsInRow.reduce((a, b) => a.x > b.x ? a : b);
    if (selectedRow === row) {
      for (const hit of seatsInRow) { ctx.beginPath(); ctx.arc(hit.x, hit.y, seatSize * 0.8, 0, TAU); ctx.fillStyle = 'rgba(23,25,28,0.06)'; ctx.fill(); }
    }
    if (compact && selectedRow !== row) continue;
    ctx.font = '10px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = selectedRow === row ? '#17191c' : '#565d66';
    ctx.fillText(physicalRowLabel(left), left.x - seatSize * 0.7 - 5, left.y);
    ctx.textAlign = 'left'; ctx.fillText(physicalRowLabel(right), right.x + seatSize * 0.7 + 5, right.y);
  }
  const planSeatOccluders = [];
  for (const [seatIndex, hit] of seatHits.entries()) {
    const isSelected = hit.row === selected?.row && hit.number === selected?.number;
    if (isSelected) {
      ctx.beginPath(); ctx.arc(hit.x, hit.y, seatSize * 0.81 + 2, 0, TAU); ctx.fillStyle = 'rgba(23,25,28,0.12)'; ctx.fill();
      ctx.strokeStyle = '#17191c'; ctx.lineWidth = 1.25; ctx.stroke();
    }
    ctx.save(); ctx.translate(hit.x, hit.y); ctx.rotate(-finite(hit.rotationDeg, 0) * Math.PI / 180);
    roundedRect(ctx, -seatSize / 2, -seatSize / 2, seatSize, seatSize * 0.8, 2);
    ctx.fillStyle = isSelected ? '#17191c' : '#dde1e6'; ctx.fill(); ctx.strokeStyle = isSelected ? '#ffffff' : '#707b88'; ctx.lineWidth = 0.65; ctx.stroke(); ctx.restore();
    const angle = -finite(hit.rotationDeg, 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const polygon = roundedRectPoints(-seatSize / 2, -seatSize / 2, seatSize, seatSize * 0.8, 2).map(point => ({
      x: hit.x + point.x * cos - point.y * sin, y: hit.y + point.x * sin + point.y * cos,
    }));
    planSeatOccluders.push({ type: 'polygon', polygon, bounds: pixelBounds(polygon), depth: 0.75, drawOrder: objects.length + actors.length + barriers.length + seatIndex });
    if (!compact && seatSize >= 10) {
      ctx.font = `500 ${clamp(seatSize * 0.48, 6, 9)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillStyle = isSelected ? '#ffffff' : '#17191c'; ctx.fillText(String(hit.number), hit.x, hit.y - seatSize * 0.07);
    }
  }
  // Occupants sit over the chair symbols so a filled seat remains legible.
  const spectatorProjections = normalizedAudience(audience, g, audienceSelectedId).map(person => {
    const center = map(person.x, person.z), radius = clamp(scale * person.heightM * 0.10, 1.5, 7);
    ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, TAU); ctx.fillStyle = person.color; ctx.fill();
    ctx.strokeStyle = person.selected ? '#17191c' : '#565d66'; ctx.lineWidth = person.selected ? 2 : 0.6; ctx.stroke();
    if (person.selected) { ctx.beginPath(); ctx.arc(center.x, center.y, radius + 2.5, 0, TAU); ctx.strokeStyle = '#17191c'; ctx.lineWidth = 1; ctx.stroke(); }
    const bounds = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
    const visible = bounds.x <= width && bounds.x + bounds.width >= 0 && bounds.y <= height && bounds.y + bounds.height >= 0;
    const inFrame = bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height;
    return { id: person.id, name: person.name, type: 'audience', pose: 'seated', projection: 'plan', seat: person.seat, preset: person.preset, selected: person.selected, center, feet: center, top: center, heightPx: 0, floorY: person.floorY, heightM: person.heightM, seatHeightM: person.seatHeightM, rotationDeg: person.rotationDeg, bounds, frontVisible: true, visible, inFrame, clipped: !inFrame, nearClipped: false };
  });
  ctx.font = '500 11px system-ui, -apple-system, sans-serif'; ctx.fillStyle = '#565d66'; ctx.textAlign = 'center';
  ctx.fillText(selected ? `${selected.label || `${selected.row}열 ${selected.number}번`} · ${compact ? '' : '바닥 높이 '}${selected.floorY.toFixed(2)} m` : '좌석을 선택하세요', width / 2, height - 15);
  overviewCache.set(canvas, { seatHits, geometry: JSON.stringify(g), width, height });
  const topLeft = bounds ? map(bounds.xMin, bounds.zMin) : { x: 0, y: 0 };
  const audienceHits = spectatorProjections.filter(person => person.visible).map(person => ({ id: person.id, name: person.name, seat: person.seat, preset: person.preset, selected: person.selected, visible: true, depth: 1, bounds: person.bounds, screen: { x: 0, y: 0, width, height }, surfaces: [{ type: 'circle', x: person.center.x, y: person.center.y, radius: person.bounds.width / 2, depth: 1 }] }));
  const stageObjectHits = [
    ...projections.filter(projection => projection.visible).map((projection, index) => ({
      id: projection.id, kind: 'structure', type: projection.type, name: projection.name,
      selected: objects.find(object => object.id === projection.id)?.selected || false,
      floorY: projection.floorY, heightM: projection.dimensions.heightM, center: projection.center,
      bounds: projection.bounds, screen, visible: true, depth: 2,
      surfaces: [{ type: 'polygon', polygon: projection.polygon, bounds: projection.bounds, depth: 2, drawOrder: index }],
    })),
    ...planPersonHits,
  ];
  Object.defineProperty(stageObjectHits, 'occluders', { value: [
    ...planBarriers.flatMap(barrier => barrier.surfaces),
    ...planSeatOccluders,
    ...spectatorProjections.filter(person => person.visible).map((person, index) => ({
      type: 'circle', x: person.center.x, y: person.center.y, radius: person.bounds.width / 2, bounds: person.bounds, depth: 0.5, drawOrder: objects.length + actors.length + barriers.length + seatHits.length + index,
    })),
  ] });
  return { seatHits, editProjection: { kind: 'plan', origin: map(0, 0), scale, viewport: screen, screen }, stageObjectHits, stageBounds: bounds ? { ...topLeft, width: bounds.widthM * scale, height: bounds.depthM * scale } : null, worldStageBounds: bounds, stageEnclosure: enclosure, wallProjections: planWalls, barrierProjections: planBarriers, audienceProjections: spectatorProjections, audienceHits, structureProjections: projections, structureHits: structureHits(projections) };
}

/** Inspect the entire structure. Side view uses row profiles for legible risers. */
export function renderModelView(canvas, { geometry = {}, seat = {}, people = [], audience = [], audienceSelectedId, structures = [], obstruction, stageEnclosure, auditoriumBarriersEnabled = true, view = 'isometric', showGrid = true, camera = {} } = {}) {
  orbitRowLabelCache.set(canvas, []);
  const prepared = prepareCanvas(canvas);
  if (!prepared) return { error: '2D canvas unavailable', seatHits: [], rowLevels: [], rowLabelAnnotations: [], audienceProjections: [], audienceHits: [], structureProjections: [], structureHits: [], barrierProjections: [], stageObjectHits: [], editProjection: null };
  const { ctx, width, height, dpr } = prepared, g = normalizeGeometry(geometry), seats = createSeatList(g);
  const objects = normalizedStructures(structures, g);
  const spectators = normalizedAudience(audience, g, audienceSelectedId);
  const enclosure = stageEnclosureData(geometry, stageEnclosure);
  const barriers = activeAuditoriumBarriers(g, auditoriumBarriersEnabled);
  const bounds = fitSceneBounds(worldBounds(g, seats), people.map((person, index) => personData(person, index, g)), objects, spectators), selected = seatPosition(g, seat, finite(camera.eyeHeightM, g.eyeHeightM)), side = view === 'side';
  if (enclosure.enabled) bounds.yMax = Math.max(bounds.yMax, ...enclosure.walls.map(wall => wall.floorY + wall.heightM));
  const stage = stageBounds(g);
  const sightTarget = vec(
    finite(camera.aimX, stage ? (stage.xMin + stage.xMax) / 2 : 0),
    finite(camera.aimY, g.stageHeightM + 0.9),
    finite(camera.aimZ, stage ? (stage.zMin + stage.zMax) / 2 : -g.stageDepthM / 2),
  );
  const center = vec((bounds.xMin + bounds.xMax) / 2, (bounds.yMin + bounds.yMax) / 2, (bounds.zMin + bounds.zMax) / 2);
  const radius = Math.max(2, Math.hypot(bounds.xMax - bounds.xMin, bounds.zMax - bounds.zMin, bounds.yMax - bounds.yMin) / 2);
  const yaw = finite(camera.yawDeg, 28) * Math.PI / 180, elevation = clamp(finite(camera.elevationDeg, 34), 10, 80) * Math.PI / 180;
  const distance = radius * 3.7;
  const position = side ? vec(center.x - distance, center.y + radius * 0.035, center.z) : add(center, vec(Math.sin(yaw) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(yaw) * Math.cos(elevation) * distance));
  const basis = cameraBasis(position, center);
  const corners = [];
  for (const x of [bounds.xMin, bounds.xMax]) for (const y of [bounds.yMin, bounds.yMax]) for (const z of [bounds.zMin, bounds.zMax]) {
    const p = cameraPoint(vec(x, y, z), basis);
    corners.push({ x: p.x / p.depth, y: p.y / p.depth });
  }
  const xMin = Math.min(...corners.map(p => p.x)), xMax = Math.max(...corners.map(p => p.x));
  const yMin = Math.min(...corners.map(p => p.y)), yMax = Math.max(...corners.map(p => p.y));
  const focal = Math.min((width - 34) / Math.max(0.001, xMax - xMin), (height - 65) / Math.max(0.001, yMax - yMin)) * clamp(finite(camera.zoom, 1), 0.5, 2);
  const viewport = { x: -(xMin + xMax) * focal / 2, y: (yMin + yMax) * focal / 2 + 12, width, height };
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, width, height);
  const walls = displayWalls(enclosure, g, side ? 'side' : 'isometric', position);
  const ground = []; addGround(ground, g, showGrid, seats, enclosure);
  const items = [], rowLevels = [];
  addStageWalls(items, walls, width < 400);
  addAuditoriumBarriers(items, barriers);
  addStageFloorLabel(items, g);
  const rows = physicalRows(seats), selectedRow = physicalRowKey(selected);
  const profiles = rows.map(([row, inRow]) => ({ row, reference: inRow.reduce((a, b) => Math.abs(a.x - center.x) < Math.abs(b.x - center.x) ? a : b) }));
  for (const { row, reference } of profiles) {
    rowLevels.push({ row, rowLabel: physicalRowLabel(reference), floorY: reference.floorY, z: reference.z });
    if (side) {
      const referenceSelected = reference.row === selected?.row && reference.number === selected?.number;
      addChair(items, reference, g, referenceSelected);
      // Flat OP rows have no rising profile to separate their labels. Lift only
      // those annotations, with a leader back to the unchanged chair height.
      const labelLift = Math.min(3, profiles.filter(other => other.row > row && other.reference.floorY === reference.floorY).length) * 0.6;
      const labelPosition = vec(reference.x, reference.floorY + 1.08 + labelLift, reference.z);
      if (labelLift) items.push({ type: 'line', points: [vec(reference.x, reference.floorY + 0.82, reference.z), vec(reference.x, labelPosition.y - 0.16, reference.z)], color: '#737d89' });
      items.push({ type: 'label', position: labelPosition, text: `${physicalRowLabel(reference)} · ${reference.floorY.toFixed(2)} m`, fontSize: width < 480 ? 7 : 9 });
      if (selectedRow === row && !referenceSelected) addChair(items, selected, g, true);
    }
  }
  if (!side) {
    seats.forEach(s => {
      const isSelected = s.row === selected?.row && s.number === selected?.number;
      addChair(items, s, g, isSelected);
    });
    if (selected) {
      items.push({ type: 'label', position: vec(selected.x, selected.y + 0.28, selected.z), text: selected.label || `${selected.row}열 ${selected.number}번`, fontSize: 10, color: '#17191c' });
    }
  }
  if (selected) {
    items.push({ type: 'sphere', center: vec(selected.x, selected.y, selected.z), radius: 0.085, color: '#f2be78' });
    items.push({ type: 'line', points: [vec(selected.x, selected.y, selected.z), sightTarget], color: 'rgba(242,190,120,0.48)', lineWidth: 1.1 });
  }
  const actors = addScenePeople(items, people, obstruction, g, { basis, viewport, focal });
  addStructures(items, objects, width < 400);
  addAudience(items, spectators);
  const drawn = drawStageAndScene(ctx, ground, items, basis, viewport, focal, dpr);
  const rowLabelAnnotations = side ? [] : drawOrbitRowLabels(ctx, rows, selected, basis, viewport, focal, width, height, drawn);
  orbitRowLabelCache.set(canvas, rowLabelAnnotations);
  ctx.fillStyle = '#565d66'; ctx.font = '11px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(side ? '측면 · 열별 단차와 시점' : '입체 · 무대 윤곽과 객석 배치', 14, 18);
  const projectedSeats = seats.map(s => ({ ...project(vec(s.x, s.floorY + 0.7, s.z), basis, viewport, focal), row: s.row, number: s.number, label: s.label, radius: 5 }));
  const projectedStage = stageOutline(g).map(p => project(vec(p.x, g.stageHeightM, p.z), basis, viewport, focal));
  const projections = structureProjections(objects, basis, viewport, focal, { x: 0, y: 0, width, height });
  const screen = { x: 0, y: 0, width, height };
  const stageSurfaceProjections = drawn.filter(item => item.stageSurfaceKind).map(item => ({ ...projectedSurface(item), fill: item.fill, worldPoints: item.points }));
  return { view: side ? 'side' : 'isometric', cameraPosition: position, cameraTarget: center, sightTarget, editProjection: { kind: 'perspective', basis, viewport, focal, screen, near: NEAR }, stageObjectHits: stageObjectHitsFromDrawn(drawn, actors, objects, screen), seatHits: projectedSeats, rowLevels, rowLabelAnnotations: copyRowAnnotations(rowLabelAnnotations), stageBounds: stage, projectedStage, stageSurfaceProjections, stageEnclosure: enclosure, wallProjections: wallProjections(walls, basis, viewport, focal, screen), barrierProjections: barrierProjections(barriers, drawn, basis, viewport, focal, screen), personProjections: personProjections(actors, position, basis, viewport, focal, screen), audienceProjections: audienceProjections(spectators, basis, viewport, focal, screen), audienceHits: audienceHitsFromDrawn(drawn, spectators, screen), structureProjections: projections, structureHits: structureHits(projections) };
}

/** x/y are relative to the canvas bounding rectangle, in CSS pixels. */
export function pickSeatAt(canvas, x, y, geometry = {}) {
  const g = normalizeGeometry(geometry), { width, height } = canvasSize(canvas);
  const cached = overviewCache.get(canvas);
  const hits = cached && cached.geometry === JSON.stringify(g) && cached.width === width && cached.height === height ? cached.seatHits : overviewLayout(width, height, g).seatHits;
  let nearest = null, nearestDistance = Infinity;
  for (const hit of hits) {
    const distance = Math.hypot(x - hit.x, y - hit.y);
    if (distance <= hit.radius && distance < nearestDistance) { nearest = hit; nearestDistance = distance; }
  }
  return nearest ? { row: nearest.row, number: nearest.number } : null;
}

// Names are a screen overlay: moving them never changes actor projections or hits.
function drawEditorPersonNames(ctx, people, width, height) {
  ctx.save(); ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const padding = 4, labelHeight = 16, gap = 3;
  const visible = people.filter(person => person.visible);
  const occupied = visible.map(person => ({ x: person.bounds.x - gap, y: person.bounds.y - gap,
    width: person.bounds.width + gap * 2, height: person.bounds.height + gap * 2 }));
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  for (const person of [...visible].sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x || a.id.localeCompare(b.id))) {
    const labelWidth = Math.min(Math.max(1, width - padding * 2), ctx.measureText(person.name).width + 6);
    const preferred = { x: person.center.x - labelWidth / 2, y: person.bounds.y - labelHeight - gap };
    let best = null, bestOverlap = Infinity, bestDistance = Infinity;
    const seen = new Set(), maxRing = Math.ceil(Math.max(width / (labelWidth + gap), height / (labelHeight + gap)));
    // Stop at the nearest free ring; dense canvases keep all names with a least-overlap fallback.
    search: for (let ring = 0; ring <= maxRing; ring++) {
      const offsets = [];
      for (let row = -ring; row <= ring; row++) for (let column = -ring; column <= ring; column++) {
        if (Math.max(Math.abs(row), Math.abs(column)) === ring) offsets.push({ x: column * (labelWidth + gap), y: row * (labelHeight + gap) });
      }
      offsets.sort((a, b) => a.x ** 2 + a.y ** 2 - b.x ** 2 - b.y ** 2);
      for (const offset of offsets) {
        const box = { x: clamp(preferred.x + offset.x, padding, Math.max(padding, width - padding - labelWidth)),
          y: clamp(preferred.y + offset.y, padding, Math.max(padding, height - padding - labelHeight)), width: labelWidth, height: labelHeight };
        const key = `${box.x},${box.y}`; if (seen.has(key)) continue; seen.add(key);
        const collisions = occupied.reduce((sum, other) => sum + overlap(box, other), 0);
        const distance = (box.x - preferred.x) ** 2 + (box.y - preferred.y) ** 2;
        if (collisions < bestOverlap || (collisions === bestOverlap && distance < bestDistance)) {
          best = box; bestOverlap = collisions; bestDistance = distance;
        }
        if (collisions === 0) break search;
      }
    }
    if (!best) continue;
    occupied.push({ x: best.x - gap / 2, y: best.y - gap / 2, width: best.width + gap, height: best.height + gap });
    const end = { x: clamp(person.center.x, best.x, best.x + best.width), y: clamp(person.center.y, best.y, best.y + best.height) };
    if (Math.hypot(best.x - preferred.x, best.y - preferred.y) > 1) {
      const dx = end.x - person.center.x, dy = end.y - person.center.y, length = Math.hypot(dx, dy);
      const radius = person.bounds.width / 2 + 2;
      if (length > radius) {
        ctx.beginPath(); ctx.moveTo(person.center.x + dx * radius / length, person.center.y + dy * radius / length);
        ctx.lineTo(end.x, end.y); ctx.strokeStyle = '#737d89'; ctx.lineWidth = 0.75; ctx.stroke();
      }
    }
    ctx.fillStyle = '#f4f5f7'; ctx.fillRect(best.x, best.y, best.width, best.height);
    ctx.fillStyle = '#17191c'; ctx.fillText(person.name, best.x + best.width / 2, best.y + best.height / 2, Math.max(1, best.width - 6));
  }
  ctx.restore();
}

/** Independent stage editor. All projection and hit coordinates are CSS pixels. */
export function renderStageEditorView(canvas, { geometry = {}, people = [], structures = [],
  view = 'top', selectedPersonIds = [], camera = {}, showGrid = true } = {}) {
  const empty = { editProjection: null, stageObjectHits: [], personProjections: [], structureProjections: [], barrierProjections: [] };
  const prepared = prepareCanvas(canvas);
  if (!prepared) return { ...empty, error: '2D canvas unavailable' };
  const { ctx, width, height } = prepared, g = normalizeGeometry(geometry), stage = stageBounds(g);
  if (!stage || !['top', 'front', '3d'].includes(view)) {
    const error = stage ? '편집 시점을 확인하세요.' : '무대 경계가 없어 편집할 수 없습니다.';
    drawError(ctx, width, height, error); return { ...empty, error };
  }
  const selected = new Set(selectedPersonIds);
  const editorPeople = people.map(person => ({ ...person, selected: selected.has(person.id) }));
  const actors = editorPeople.map((person, index) => personData(person, index, g));
  const objects = normalizedStructures(structures, g);
  const bounds = fitSceneBounds({ ...stage, yMin: Math.min(0, g.stageHeightM), yMax: g.stageHeightM + 2 }, actors, objects);
  const screen = { x: 0, y: 0, width, height }, zoom = clamp(finite(camera.zoom, 1), 0.5, 2);
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, width, height);
  if (view === 'top') {
    const scale = Math.max(0.01, Math.min(Math.max(1, width - 48) / (bounds.xMax - bounds.xMin + 0.8),
      Math.max(1, height - 60) / (bounds.zMax - bounds.zMin + 0.8))) * zoom;
    const origin = { x: width / 2 - (bounds.xMin + bounds.xMax) / 2 * scale,
      y: height / 2 + 10 - (bounds.zMin + bounds.zMax) / 2 * scale };
    const map = (x, z) => ({ x: origin.x + x * scale, y: origin.y + z * scale });
    outlinePath(ctx, stageOutline(g), map); ctx.fillStyle = SCENE_COLORS.stageFloor; ctx.fill();
    ctx.strokeStyle = SCENE_COLORS.stageEdge; ctx.lineWidth = 1.5; ctx.stroke();
    if (showGrid) {
      const grid = []; addStageGrid(grid, g);
      for (const line of grid) {
        const [a, b] = line.points.map(point => map(point.x, point.z));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = '#7c8793'; ctx.lineWidth = 0.5; ctx.stroke();
      }
    }
    const structureViews = objects.map((object, index) => {
      const polygon = structureFootprint(object).map(point => map(point.x, point.z)), bounds = pixelBounds(polygon);
      ctx.beginPath(); polygon.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
      ctx.fillStyle = object.color; ctx.fill(); ctx.strokeStyle = object.selected ? '#17191c' : '#5f6a78'; ctx.lineWidth = object.selected ? 2 : 1; ctx.stroke();
      return { id: object.id, kind: 'structure', type: object.type, name: object.name, selected: object.selected,
        floorY: object.floorY, heightM: object.heightM, center: map(object.x, object.z), bounds, polygon,
        visible: boundsIntersect(bounds, screen), depth: 2, screen,
        surfaces: [{ type: 'polygon', polygon, bounds, depth: 2, drawOrder: index }] };
    });
    const personViews = actors.map((person, index) => {
      const center = map(person.x, person.z), radius = Math.max(5, scale * person.heightM * 0.12);
      ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, TAU); ctx.fillStyle = person.color; ctx.fill();
      ctx.strokeStyle = person.selected ? '#17191c' : '#565d66'; ctx.lineWidth = person.selected ? 3 : 1; ctx.stroke();
      const angle = person.facingDeg * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(center.x + Math.sin(angle) * (radius + 9), center.y + Math.cos(angle) * (radius + 9));
      ctx.strokeStyle = '#17191c'; ctx.lineWidth = 1.5; ctx.stroke();
      const bounds = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
      return { id: person.id, kind: 'person', type: 'person', name: person.name, selected: person.selected,
        floorY: person.floorY, heightM: person.heightM, center, feet: center, top: center, bounds,
        visible: boundsIntersect(bounds, screen), depth: 1, screen,
        surfaces: [{ type: 'circle', x: center.x, y: center.y, radius, bounds, depth: 1, drawOrder: objects.length + index }] };
    });
    drawEditorPersonNames(ctx, personViews, width, height);
    return { view, editProjection: { kind: 'plan', origin, scale, viewport: screen, screen },
      stageObjectHits: [...structureViews, ...personViews].filter(hit => hit.visible),
      personProjections: personViews, structureProjections: structureViews, barrierProjections: [], stageBounds: stage };
  }
  const center = vec((bounds.xMin + bounds.xMax) / 2, (bounds.yMin + bounds.yMax) / 2, (bounds.zMin + bounds.zMax) / 2);
  const radius = Math.max(2, Math.hypot(bounds.xMax - bounds.xMin, bounds.zMax - bounds.zMin, bounds.yMax - bounds.yMin) / 2);
  const distance = radius * 4;
  const yaw = finite(camera.yawDeg, 28) * Math.PI / 180, elevation = clamp(finite(camera.elevationDeg, 34), 10, 80) * Math.PI / 180;
  const position = view === 'front' ? add(center, vec(0, 0, distance))
    : add(center, vec(Math.sin(yaw) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(yaw) * Math.cos(elevation) * distance));
  const basis = cameraBasis(position, center);
  const viewport = { ...screen }, corners = [];
  for (const x of [bounds.xMin - 0.4, bounds.xMax + 0.4]) for (const y of [bounds.yMin, bounds.yMax + 0.3]) for (const z of [bounds.zMin - 0.4, bounds.zMax + 0.4]) {
    const point = cameraPoint(vec(x, y, z), basis);
    corners.push(view === 'front' ? { x: point.x, y: point.y } : { x: point.x / point.depth, y: point.y / point.depth });
  }
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const scale = Math.max(0.01, Math.min(Math.max(1, width - 40) / (Math.max(...xs) - Math.min(...xs)),
    Math.max(1, height - 56) / (Math.max(...ys) - Math.min(...ys)))) * zoom;
  viewport.x = -(Math.max(...xs) + Math.min(...xs)) * scale / 2;
  viewport.y = (Math.max(...ys) + Math.min(...ys)) * scale / 2 + 10;
  if (view === 'front') viewport.orthographicScale = scale;
  const ground = []; addPrism(ground, stageOutline(g), g.stageHeightM, Math.min(0, g.stageHeightM), SCENE_COLORS.stageFloor, SCENE_COLORS.stageEdge);
  if (showGrid) addStageGrid(ground, g);
  drawItems(ctx, ground, basis, viewport, scale);
  const items = [];
  const renderedActors = addScenePeople(items, editorPeople, null, g, { basis, viewport, focal: scale });
  addStructures(items, objects, width < 400);
  const drawn = drawItems(ctx, items, basis, viewport, scale);
  const origin = { x: viewport.x + width / 2 - center.x * scale, y: viewport.y + height / 2 + center.y * scale };
  return { view, editProjection: view === 'front'
    ? { kind: 'front', origin, scale, viewport: screen, screen }
    : { kind: 'perspective', basis, viewport, focal: scale, screen, near: NEAR },
    stageObjectHits: stageObjectHitsFromDrawn(drawn, renderedActors, objects, screen),
    personProjections: personProjections(renderedActors, position, basis, viewport, scale, screen),
    structureProjections: structureProjections(objects, basis, viewport, scale, screen),
    barrierProjections: [], stageBounds: stage, cameraPosition: position, cameraTarget: center };
}
