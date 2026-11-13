import { isPointOnStage, normalizeGeometry, stageBounds } from './geometry.js';
import { DEFAULT_BODY_PRESET, normalizeBodyPreset, defaultBodyColor } from './body-profile.js';

/** Editable positions are metres in the active model; no venue facts are changed. */
export const MAX_STAGE_PEOPLE = 128;
const STRUCTURE_LIMIT = 20;
const PRESETS = new Set(['center', 'front', 'back', 'left', 'right']);
const numeric = value => value !== null && value !== undefined && value !== ''
  && !(typeof value === 'string' && !value.trim()) && typeof value !== 'boolean' && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finiteCoordinate = (value, fallback) => numeric(value) ? clamp(Number(value), -1000, 1000) : fallback;
const boundedPositive = (value, min, max) => numeric(value) && Number(value) > 0 ? clamp(Number(value), min, max) : null;
const color = value => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
const name = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null;

function outline(g, bounds) {
  return own(g, 'stagePolygon') ? g.stagePolygon : [
    { x: bounds.xMin, z: bounds.zMin }, { x: bounds.xMax, z: bounds.zMin },
    { x: bounds.xMax, z: bounds.zMax }, { x: bounds.xMin, z: bounds.zMax },
  ];
}

/** Project onto the nearest stage edge. Boundary points count as on stage. */
export function constrainStagePosition(geometry, x, z) {
  const g = normalizeGeometry(geometry), bounds = stageBounds(g);
  // An explicitly missing outline cannot provide an interior point. Keep the
  // data finite; callers must disable editing when stageBounds is null.
  if (!bounds) return { x: 0, z: 0 };
  const point = {
    x: finiteCoordinate(x, (bounds.xMin + bounds.xMax) / 2),
    z: finiteCoordinate(z, (bounds.zMin + bounds.zMax) / 2),
  };
  if (isPointOnStage(g, point.x, point.z)) return point;
  let nearest = null, distanceSquared = Infinity;
  const polygon = outline(g, bounds);
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared, 0, 1) : 0;
    const candidate = { x: a.x + t * dx, z: a.z + t * dz };
    const distance = (candidate.x - point.x) ** 2 + (candidate.z - point.z) ** 2;
    if (distance < distanceSquared) { nearest = candidate; distanceSquared = distance; }
  }
  return nearest || { x: 0, z: 0 };
}

export function personPositionForPreset(geometry, preset = 'center') {
  const g = normalizeGeometry(geometry), bounds = stageBounds(g);
  if (!bounds) return { x: 0, z: 0 };
  const center = { x: (bounds.xMin + bounds.xMax) / 2, z: (bounds.zMin + bounds.zMax) / 2 };
  const edgeInset = Math.min(0.6, bounds.depthM / 5);
  const positions = {
    center,
    front: { x: center.x, z: bounds.zMax - edgeInset },
    back: { x: center.x, z: bounds.zMin + edgeInset },
    left: { x: center.x - bounds.widthM * 0.325, z: center.z },
    right: { x: center.x + bounds.widthM * 0.325, z: center.z },
  };
  const position = positions[preset] || center;
  return constrainStagePosition(g, position.x, position.z);
}

export function createStageLayout(geometry) {
  return {
    people: [],
    structures: [], selectedPersonId: null, selectedStructureId: null,
    nextPersonId: 1, nextStructureId: 1,
  };
}

function allocateId(layout, collection, prefix, counterKey) {
  const candidate = Number(layout[counterKey]);
  let counter = Number.isSafeInteger(candidate) && candidate >= 1
    && candidate <= Number.MAX_SAFE_INTEGER - collection.length - 2 ? candidate : 1;
  const ids = new Set(collection.map(item => item.id));
  while (ids.has(`${prefix}-${counter}`)) counter += 1;
  layout[counterKey] = counter + 1;
  return { id: `${prefix}-${counter}`, number: counter };
}

function dispersedPosition(layout, geometry) {
  const bounds = stageBounds(geometry), center = personPositionForPreset(geometry, 'center');
  if (!bounds) return center;
  const occupied = [...layout.people, ...layout.structures].filter(item => numeric(item.x) && numeric(item.z));
  const separation = Math.min(0.75, bounds.widthM / 5, bounds.depthM / 5);
  let best = center, bestDistance = -1;
  for (let index = 0; index <= 96; index += 1) {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = index ? separation * (1 + Math.floor((index - 1) / 8)) : 0;
    const point = constrainStagePosition(geometry, center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
    const distance = occupied.length ? Math.min(...occupied.map(item => Math.hypot(item.x - point.x, item.z - point.z))) : Infinity;
    if (distance > bestDistance) { bestDistance = distance; best = point; }
    if (distance >= separation * 0.98) return point;
  }
  return best;
}

export function addPerson(layout, geometry, { bodyPreset = DEFAULT_BODY_PRESET } = {}) {
  if (layout.people.length >= MAX_STAGE_PEOPLE) return null;
  const preset = normalizeBodyPreset(bodyPreset);
  const identity = allocateId(layout, layout.people, 'person', 'nextPersonId');
  const person = { id: identity.id, name: `인물 ${identity.number}`, ...dispersedPosition(layout, geometry),
    heightM: preset === 'female' ? 1.60 : 1.75, bodyPreset: preset, color: defaultBodyColor(preset), position: 'custom', facingDeg: 0, pose: 'standing' };
  layout.people.push(person);
  layout.selectedPersonId = person.id;
  return person;
}

export function removePerson(layout, id) {
  const index = layout.people.findIndex(item => item.id === id);
  if (index < 0) return false;
  layout.people.splice(index, 1);
  if (!layout.people.some(item => item.id === layout.selectedPersonId)) {
    layout.selectedPersonId = layout.people[Math.min(index, layout.people.length - 1)]?.id || null;
  }
  return true;
}

export function updatePerson(layout, id, patch, geometry) {
  const person = layout.people.find(item => item.id === id);
  if (!person || !patch || typeof patch !== 'object') return false;
  const updatedName = name(patch.name), updatedColor = color(patch.color);
  const height = boundedPositive(patch.heightM, 0.3, 3);
  if (updatedName) person.name = updatedName;
  if (updatedColor) person.color = updatedColor;
  if (height !== null) person.heightM = height;
  if (patch.bodyPreset === 'male' || patch.bodyPreset === 'female') person.bodyPreset = patch.bodyPreset;
  if (['standing', 'chair', 'floor', 'cross-legged'].includes(patch.pose)) person.pose = patch.pose;
  // Facing: 0 = audience (+z), +90 = audience-right (+x).
  if (numeric(patch.facingDeg) && Number(patch.facingDeg) >= -180 && Number(patch.facingDeg) <= 360) {
    person.facingDeg = ((Number(patch.facingDeg) + 180) % 360 + 360) % 360 - 180;
  }
  if (PRESETS.has(patch.position)) {
    Object.assign(person, personPositionForPreset(geometry, patch.position), { position: patch.position });
  }
  // Explicit coordinates take priority over a preset in the same patch.
  if (numeric(patch.x) || numeric(patch.z)) {
    Object.assign(person, constrainStagePosition(geometry,
      numeric(patch.x) ? patch.x : person.x, numeric(patch.z) ? patch.z : person.z), { position: 'custom' });
  }
  return person;
}

export function addStructure(layout, geometry, type = 'box') {
  if (layout.structures.length >= STRUCTURE_LIMIT || !['box', 'cylinder'].includes(type)) return null;
  const identity = allocateId(layout, layout.structures, 'structure', 'nextStructureId');
  const structure = { id: identity.id, type, name: `${type === 'box' ? '상자' : '원통'} ${identity.number}`,
    ...dispersedPosition(layout, geometry), widthM: type === 'box' ? 1.5 : 1,
    depthM: 1, diameterM: 1, heightM: type === 'box' ? 1.2 : 1.8,
    rotationDeg: 0, color: type === 'box' ? '#cbb17b' : '#84b3c3' };
  layout.structures.push(structure);
  layout.selectedStructureId = structure.id;
  return structure;
}

export function removeStructure(layout, id) {
  const index = layout.structures.findIndex(item => item.id === id);
  if (index < 0) return false;
  layout.structures.splice(index, 1);
  if (!layout.structures.some(item => item.id === layout.selectedStructureId)) {
    layout.selectedStructureId = layout.structures.length
      ? layout.structures[Math.min(index, layout.structures.length - 1)].id : null;
  }
  return true;
}

export function updateStructure(layout, id, patch, geometry) {
  const structure = layout.structures.find(item => item.id === id);
  if (!structure || !patch || typeof patch !== 'object') return false;
  const updatedName = name(patch.name), updatedColor = color(patch.color);
  if (updatedName) structure.name = updatedName;
  if (updatedColor) structure.color = updatedColor;
  for (const dimension of ['height', 'width', 'depth', 'diameter']) {
    const key = `${dimension}M`, value = boundedPositive(own(patch, key) ? patch[key] : patch[dimension], 0.05, 30);
    if (value !== null) structure[key] = value;
  }
  if (numeric(patch.rotationDeg)) structure.rotationDeg = ((Number(patch.rotationDeg) + 180) % 360 + 360) % 360 - 180;
  if (numeric(patch.x) || numeric(patch.z)) {
    Object.assign(structure, constrainStagePosition(geometry,
      numeric(patch.x) ? patch.x : structure.x, numeric(patch.z) ? patch.z : structure.z));
  }
  return structure;
}

/** Reproject into the new footprint without sharing or resetting object positions. */
export function reconcileStageLayout(layout, geometry) {
  for (const person of layout.people) {
    person.bodyPreset = normalizeBodyPreset(person.bodyPreset);
    person.facingDeg = numeric(person.facingDeg) && Number(person.facingDeg) >= -180 && Number(person.facingDeg) <= 360
      ? ((Number(person.facingDeg) + 180) % 360 + 360) % 360 - 180 : 0;
    const point = PRESETS.has(person.position) ? personPositionForPreset(geometry, person.position)
      : constrainStagePosition(geometry, person.x, person.z);
    Object.assign(person, point);
  }
  for (const structure of layout.structures) Object.assign(structure, constrainStagePosition(geometry, structure.x, structure.z));
  if (!layout.people.some(item => item.id === layout.selectedPersonId)) layout.selectedPersonId = layout.people[0]?.id ?? null;
  if (!layout.structures.some(item => item.id === layout.selectedStructureId)) layout.selectedStructureId = layout.structures[0]?.id ?? null;
  return layout;
}

const FOOTPRINT_EPSILON = 1e-9;
const cross2D = (a, b) => a.x * b.z - a.z * b.x;
const difference2D = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });

/** Parameters on segment AB at its intersections with CD, including overlaps. */
function segmentIntersectionParameters(a, b, c, d) {
  const r = difference2D(b, a), s = difference2D(d, c), offset = difference2D(c, a);
  const lengthSquared = r.x * r.x + r.z * r.z;
  if (lengthSquared <= FOOTPRINT_EPSILON ** 2) return [];
  const denominator = cross2D(r, s);
  const parallelTolerance = FOOTPRINT_EPSILON * Math.max(1, Math.hypot(r.x, r.z) * Math.hypot(s.x, s.z));
  if (Math.abs(denominator) > parallelTolerance) {
    const t = cross2D(offset, s) / denominator, u = cross2D(offset, r) / denominator;
    return t >= -FOOTPRINT_EPSILON && t <= 1 + FOOTPRINT_EPSILON
      && u >= -FOOTPRINT_EPSILON && u <= 1 + FOOTPRINT_EPSILON ? [clamp(t, 0, 1)] : [];
  }
  if (Math.abs(cross2D(offset, r)) > FOOTPRINT_EPSILON * Math.max(1, Math.hypot(r.x, r.z))) return [];
  const t0 = (offset.x * r.x + offset.z * r.z) / lengthSquared;
  const endOffset = difference2D(d, a), t1 = (endOffset.x * r.x + endOffset.z * r.z) / lengthSquared;
  const start = Math.max(0, Math.min(t0, t1)), end = Math.min(1, Math.max(t0, t1));
  return start <= end + FOOTPRINT_EPSILON ? [clamp(start, 0, 1), clamp(end, 0, 1)] : [];
}

function validStageOutline(geometry, polygon) {
  if (own(geometry, 'stagePolygon') && (!Array.isArray(geometry.stagePolygon)
      || geometry.stagePolygon.some(point => !point || !numeric(point.x) || !numeric(point.z)
        || Math.abs(Number(point.x)) > 1000 || Math.abs(Number(point.z)) > 1000))) return false;
  if (polygon.length < 3) return false;
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) <= FOOTPRINT_EPSILON) return false;
    twiceArea += cross2D(a, b);
    for (let other = index + 1; other < polygon.length; other += 1) {
      // Adjacent edges meet at their common vertex by definition.
      if (other === index + 1 || (index === 0 && other === polygon.length - 1)) continue;
      if (segmentIntersectionParameters(a, b, polygon[other], polygon[(other + 1) % polygon.length]).length) return false;
    }
  }
  return Math.abs(twiceArea) > FOOTPRINT_EPSILON;
}

function checkedStructureFootprint(structure) {
  if (!structure || !['box', 'cylinder'].includes(structure.type)
      || !numeric(structure.x) || !numeric(structure.z)) return null;
  const x = Number(structure.x), z = Number(structure.z);
  const dimension = (value, fallback) => value === undefined ? fallback
    : numeric(value) && Number(value) > 0 ? clamp(Number(value), 0.05, 100) : null;
  if (structure.type === 'cylinder') {
    const diameter = dimension(structure.diameterM, 1);
    if (diameter === null) return null;
    return Array.from({ length: 24 }, (_, index) => ({
      x: x + Math.cos(Math.PI * 2 * index / 24) * diameter / 2,
      z: z + Math.sin(Math.PI * 2 * index / 24) * diameter / 2,
    }));
  }
  const width = dimension(structure.widthM, 1.5), depth = dimension(structure.depthM, 1);
  if (width === null || depth === null || (structure.rotationDeg !== undefined && !numeric(structure.rotationDeg))) return null;
  const angle = (Number(structure.rotationDeg ?? 0) % 360) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const dx = sx * width / 2, dz = sz * depth / 2;
    return { x: x + dx * cos + dz * sin, z: z - dx * sin + dz * cos };
  });
}

/**
 * Check the rendered footprint, including edges crossing concave stage recesses.
 * This is a warning check: it never moves or resizes the structure. Cylinders
 * use the same 24-sided footprint as the renderer. Boundary contact is allowed.
 */
export function isStructureWithinStage(geometry, structure) {
  const g = normalizeGeometry(geometry), bounds = stageBounds(g);
  if (!bounds) return false;
  const polygon = outline(g, bounds), footprint = checkedStructureFootprint(structure);
  // Point containment needs no seats or platforms. Avoid normalizing the full
  // venue layout again for every point in a cylinder's footprint.
  const stageGeometry = own(g, 'stagePolygon') ? { stagePolygon: polygon }
    : { stageWidthM: g.stageWidthM, stageDepthM: g.stageDepthM };
  if (!validStageOutline(geometry || {}, polygon) || !footprint
      || !footprint.every(point => isPointOnStage(stageGeometry, point.x, point.z))) return false;
  for (let index = 0; index < footprint.length; index += 1) {
    const a = footprint[index], b = footprint[(index + 1) % footprint.length], parameters = [0, 1];
    for (let edge = 0; edge < polygon.length; edge += 1) {
      parameters.push(...segmentIntersectionParameters(a, b, polygon[edge], polygon[(edge + 1) % polygon.length]));
    }
    parameters.sort((left, right) => left - right);
    for (let interval = 1; interval < parameters.length; interval += 1) {
      if (parameters[interval] - parameters[interval - 1] <= FOOTPRINT_EPSILON) continue;
      const t = (parameters[interval] + parameters[interval - 1]) / 2;
      if (!isPointOnStage(stageGeometry, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
  }
  return true;
}
