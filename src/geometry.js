import { normalizeAuditoriumBarriers } from './auditorium-barriers.js';

/**
 * Metres, with +x to the viewer's right, +y up and +z toward the audience.
 * Stage front is z = 0; the stage extends into negative z.
 */
export const DEFAULT_GEOMETRY = Object.freeze({
  stageWidthM: 10,
  stageDepthM: 7,
  stageHeightM: 0.6,
  rowCount: 10,
  seatsPerRow: 12,
  rowSpacingM: 0.9,
  seatSpacingM: 0.55,
  firstRowDistanceM: 3,
  rowRiseM: 0.16,
  eyeHeightM: 1.2,
});

const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0
  ? Number(value) : fallback;
const nonnegative = (value, fallback) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
  ? Number(value) : fallback;
const numeric = (value) => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value));
const coordinate = (value) => numeric(value) && Math.abs(Number(value)) <= 1000;
const integer = (value) => numeric(value) && Number(value) >= 1 && Number(value) <= 500 && Number.isInteger(Number(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizeOutline(points) {
  if (!Array.isArray(points)) return [];
  const result = points.filter(point => point && coordinate(point.x) && coordinate(point.z))
    .map(point => ({ ...point, x: Number(point.x), z: Number(point.z) }));
  if (result.length > 1 && result[0].x === result.at(-1).x && result[0].z === result.at(-1).z) result.pop();
  return result;
}

export function normalizeGeometry(geometry = {}) {
  if (!geometry || typeof geometry !== 'object') geometry = {};
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_GEOMETRY)) {
    result[key] = ['stageHeightM', 'rowRiseM'].includes(key)
      ? nonnegative(geometry[key], fallback)
      : positive(geometry[key], fallback);
  }
  result.rowCount = Math.min(500, Math.max(1, Math.round(result.rowCount)));
  result.seatsPerRow = Math.min(500, Math.max(1, Math.round(result.seatsPerRow)));
  for (const key of Object.keys(DEFAULT_GEOMETRY)) {
    if (!['rowCount', 'seatsPerRow'].includes(key)) result[key] = Math.min(1000, result[key]);
  }
  // An explicit empty layout remains empty. Never silently replace a damaged
  // traced layout with a rectangular set of invented seats or a stage.
  for (const key of ['stagePolygon', 'roomBoundary']) {
    if (own(geometry, key)) result[key] = normalizeOutline(geometry[key]);
  }
  if (own(geometry, 'seats')) {
    const identifiers = new Set();
    result.seats = (Array.isArray(geometry.seats) ? geometry.seats : []).filter(seat => {
      if (!seat || !integer(seat.row) || !integer(seat.number) || !coordinate(seat.x) || !coordinate(seat.z) || !coordinate(seat.floorY)) return false;
      const id = `${Number(seat.row)}:${Number(seat.number)}`;
      if (identifiers.has(id)) return false;
      identifiers.add(id);
      return true;
    }).map(seat => ({
      ...seat,
      row: Number(seat.row), number: Number(seat.number),
      x: Number(seat.x), z: Number(seat.z), floorY: Number(seat.floorY),
      label: String(seat.label || `${seat.row}열 ${seat.number}번`),
      rowLabel: String(seat.rowLabel || seat.row),
      rotationDeg: coordinate(seat.rotationDeg) ? ((Number(seat.rotationDeg) + 180) % 360 + 360) % 360 - 180 : 0,
    }));
    if (result.seats.length) {
      result.rowCount = Math.max(...result.seats.map(seat => seat.row));
      result.seatsPerRow = Math.max(...result.seats.map(seat => seat.number));
    }
  }
  if (own(geometry, 'rowPlatforms')) {
    result.rowPlatforms = (Array.isArray(geometry.rowPlatforms) ? geometry.rowPlatforms : [])
      .filter(platform => platform && integer(platform.row) && ['y', 'zStart', 'zEnd', 'xMin', 'xMax'].every(key => coordinate(platform[key])) && Number(platform.zEnd) > Number(platform.zStart) && Number(platform.xMax) > Number(platform.xMin))
      .map(platform => ({ ...platform, row: Number(platform.row), ...Object.fromEntries(['y', 'zStart', 'zEnd', 'xMin', 'xMax'].map(key => [key, Number(platform[key])])) }));
  }
  if (own(geometry, 'auditoriumBarriers')) {
    const barriers = normalizeAuditoriumBarriers(geometry.auditoriumBarriers);
    if (barriers) result.auditoriumBarriers = barriers;
  }
  return result;
}

/** The outline is in world metres, independent of any canvas projection. */
export function stageBounds(geometry = {}) {
  const g = normalizeGeometry(geometry);
  const points = own(g, 'stagePolygon') ? g.stagePolygon : [
    { x: -g.stageWidthM / 2, z: -g.stageDepthM }, { x: g.stageWidthM / 2, z: 0 },
  ];
  if (points.length < (own(g, 'stagePolygon') ? 3 : 2)) return null;
  const xMin = Math.min(...points.map(point => point.x)), xMax = Math.max(...points.map(point => point.x));
  const zMin = Math.min(...points.map(point => point.z)), zMax = Math.max(...points.map(point => point.z));
  return { xMin, xMax, zMin, zMax, widthM: xMax - xMin, depthM: zMax - zMin };
}

export function isPointOnStage(geometry, x, z) {
  if (!coordinate(x) || !coordinate(z)) return false;
  const g = normalizeGeometry(geometry), bounds = stageBounds(g);
  if (!bounds) return false;
  x = Number(x); z = Number(z);
  if (!own(g, 'stagePolygon')) return x >= bounds.xMin && x <= bounds.xMax && z >= bounds.zMin && z <= bounds.zMax;
  let inside = false;
  for (let i = 0, j = g.stagePolygon.length - 1; i < g.stagePolygon.length; j = i, i += 1) {
    const a = g.stagePolygon[j], b = g.stagePolygon[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const cross = (x - a.x) * dz - (z - a.z) * dx;
    if (Math.abs(cross) <= 1e-7 * Math.max(1, Math.hypot(dx, dz)) && x >= Math.min(a.x, b.x) - 1e-7 && x <= Math.max(a.x, b.x) + 1e-7 && z >= Math.min(a.z, b.z) - 1e-7 && z <= Math.max(a.z, b.z) + 1e-7) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Return a seat's camera position, including the floor level separately. */
export function seatPosition(geometry, seat = {}, eyeHeightM) {
  const g = normalizeGeometry(geometry);
  if (own(g, 'seats')) {
    const found = g.seats.find(item => item.row === Number(seat.row) && item.number === Number(seat.number));
    if (!found) return null;
    return { ...found, y: found.floorY + nonnegative(eyeHeightM, g.eyeHeightM) };
  }
  const row = Math.min(g.rowCount, Math.max(1, Math.round(Number(seat.row) || 1)));
  const number = Math.min(g.seatsPerRow, Math.max(1, Math.round(Number(seat.number) || 1)));
  const floorY = (row - 1) * g.rowRiseM;
  const eye = nonnegative(eyeHeightM, g.eyeHeightM);
  return {
    row,
    number,
    x: (number - (g.seatsPerRow + 1) / 2) * g.seatSpacingM,
    y: floorY + eye,
    z: g.firstRowDistanceM + (row - 1) * g.rowSpacingM,
    floorY,
  };
}

/** Seat centres are on each row's floor; use seatPosition for a viewpoint. */
export function createSeatList(geometry) {
  const g = normalizeGeometry(geometry);
  if (own(g, 'seats')) return g.seats.map(seat => ({ ...seat, y: seat.floorY }));
  const seats = [];
  for (let row = 1; row <= g.rowCount; row += 1) {
    for (let number = 1; number <= g.seatsPerRow; number += 1) {
      seats.push({ ...seatPosition(g, { row, number }, 0), label: `${row}열 ${number}번` });
    }
  }
  return seats;
}
