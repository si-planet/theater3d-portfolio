import { normalizeGeometry, stageBounds } from './geometry.js';
import { normalizeStageWallSides } from './stage-wall-settings.js';

const EPSILON = 1e-9;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const numeric = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean'
  && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value));
const pointCopy = point => ({ x: point.x, z: point.z });
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

function onSegment(point, a, b) {
  return Math.abs(cross(a, b, point)) <= EPSILON && point.x >= Math.min(a.x, b.x) - EPSILON
    && point.x <= Math.max(a.x, b.x) + EPSILON && point.z >= Math.min(a.z, b.z) - EPSILON
    && point.z <= Math.max(a.z, b.z) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b);
  const oppositeSides = (left, right) => (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
  return (oppositeSides(c1, c2) && oppositeSides(c3, c4))
    || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function areaIfValid(geometry, polygon) {
  if (own(geometry, 'stagePolygon') && (!Array.isArray(geometry.stagePolygon)
      || geometry.stagePolygon.some(point => !point || !numeric(point.x) || !numeric(point.z)
        || Math.abs(Number(point.x)) > 1000 || Math.abs(Number(point.z)) > 1000))) return null;
  if (polygon.length < 3) return null;
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) <= EPSILON) return null;
    twiceArea += a.x * b.z - a.z * b.x;
    for (let other = index + 1; other < polygon.length; other += 1) {
      if (other === index + 1 || (index === 0 && other === polygon.length - 1)) continue;
      if (segmentsIntersect(a, b, polygon[other], polygon[(other + 1) % polygon.length])) return null;
    }
  }
  return Math.abs(twiceArea) > EPSILON ? twiceArea : null;
}

function frontEdgeIndices(polygon, twiceArea) {
  const edges = polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length], dx = b.x - a.x, dz = b.z - a.z;
    // For clockwise outlines the outward normal is (-dz,+dx); invert for CCW.
    const normalZ = twiceArea < 0 ? dx : -dx;
    return { index, length: Math.hypot(dx, dz), middleZ: (a.z + b.z) / 2,
      frontFacing: normalZ > EPSILON && normalZ + EPSILON >= Math.abs(dz) };
  });
  const firstOther = edges.findIndex(edge => !edge.frontFacing);
  const chains = []; let current = [];
  for (let step = 1; step <= edges.length; step += 1) {
    const edge = edges[(firstOther + step) % edges.length];
    if (edge.frontFacing) current.push(edge);
    else if (current.length) { chains.push(current); current = []; }
  }
  if (current.length) chains.push(current);
  if (!chains.length) {
    // A very narrow pointed front has no <=45-degree facing edge. Use its
    // frontmost outward-facing segment instead; this remains a model choice.
    const candidates = edges.filter(edge => {
      const a = polygon[edge.index], b = polygon[(edge.index + 1) % polygon.length];
      return (twiceArea < 0 ? b.x - a.x : a.x - b.x) > EPSILON;
    });
    return candidates.sort((a, b) => b.middleZ - a.middleZ || b.length - a.length).slice(0, 1).map(edge => edge.index);
  }
  const score = chain => chain.reduce((sum, edge) => sum + edge.middleZ * edge.length, 0)
    / chain.reduce((sum, edge) => sum + edge.length, 0);
  chains.sort((a, b) => score(b) - score(a));
  return chains[0].map(edge => edge.index).sort((a, b) => a - b);
}

/** Extrude the active footprint; actual wall height, thickness and doors are unknown. */
export function buildStageEnclosure(geometry, options = {}) {
  const g = normalizeGeometry(geometry), bounds = stageBounds(g);
  const requestedHeight = options?.heightM;
  const sides = normalizeStageWallSides(options?.sides);
  const heightM = numeric(requestedHeight) && Number(requestedHeight) > 0
    ? Math.min(50, Number(requestedHeight)) : 3;
  const result = {
    walls: [], sides, openFrontEdges: [], frontOpenings: [], source: 'model_assumption', heightSource: 'model_assumption',
    footprintSource: own(g, 'stagePolygon') ? 'active_geometry_interpretation' : 'synthetic_geometry',
    heightM, note: '벽 높이는 모델 가정이며 무대 외곽은 활성 모델을 따릅니다. 도면 외곽 해석과 실제 벽을 구분하며 벽 두께·출입구는 재현하지 않습니다.',
    openingMethod: 'front_facing_contiguous_chain_with_highest_length_weighted_z',
  };
  if (!bounds) return result;
  const polygon = own(g, 'stagePolygon') ? g.stagePolygon : [
    { x: bounds.xMin, z: bounds.zMin }, { x: bounds.xMax, z: bounds.zMin },
    { x: bounds.xMax, z: bounds.zMax }, { x: bounds.xMin, z: bounds.zMax },
  ];
  const area = areaIfValid(geometry || {}, polygon);
  if (area === null) return result;
  result.openFrontEdges = frontEdgeIndices(polygon, area);
  const open = new Set(result.openFrontEdges);
  const centerX = (bounds.xMin + bounds.xMax) / 2, centerZ = (bounds.zMin + bounds.zMax) / 2;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    if (open.has(index)) { result.frontOpenings.push({ index, a: pointCopy(a), b: pointCopy(b) }); continue; }
    const dx = ((a.x + b.x) / 2 - centerX) / (bounds.widthM / 2);
    const dz = ((a.z + b.z) / 2 - centerZ) / (bounds.depthM / 2);
    const side = dz < 0 && Math.abs(dz) >= Math.abs(dx) ? 'back' : dx < 0 ? 'left' : 'right';
    if (options?.enabled === false || !sides[side]) continue;
    result.walls.push({ a: pointCopy(a), b: pointCopy(b), floorY: g.stageHeightM, heightM, side, edgeIndex: index });
  }
  return result;
}
