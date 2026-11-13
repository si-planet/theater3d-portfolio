import { createSeatList } from './geometry.js';

/** Existing block membership only; never infer a section from positions. */
export function authoredSeatBlockPreview(geometry, blocks) {
  const members = new Map();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block.key !== 'string' || !Array.isArray(block.seatKeys)) continue;
    for (const key of block.seatKeys) {
      if (members.has(key) && (!members.get(key) || members.get(key).key !== block.key)) members.set(key, null);
      else if (!members.has(key)) members.set(key, block);
    }
  }
  return createSeatList(geometry).flatMap(seat => {
    const block = members.get(`${seat.row}:${seat.number}`);
    if (!block) return [];
    const rotationDeg = Number.isFinite(seat.rotationDeg) ? seat.rotationDeg : 0;
    const angle = rotationDeg * Math.PI / 180;
    // The same chair convention as scene.js: local front is negative z.
    return [{ row: seat.row, number: seat.number, x: seat.x, z: seat.z,
      blockKey: block.key, blockLabel: block.label, rotationDeg,
      front: { x: -Math.sin(angle), z: -Math.cos(angle) } }];
  });
}

export function pickAuthoredSeatBlock(projectedSeats, point, { tolerancePx = 14 } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(tolerancePx) || tolerancePx < 0) return null;
  const hits = projectedSeats.filter(seat => Number.isFinite(seat.x) && Number.isFinite(seat.y))
    .map(seat => ({ seat, distance: Math.hypot(seat.x - point.x, seat.y - point.y) }))
    .filter(hit => hit.distance <= tolerancePx).sort((a, b) => a.distance - b.distance);
  if (!hits.length) return null;
  if (hits[1] && Math.abs(hits[0].distance - hits[1].distance) < .5 && hits[0].seat.blockKey !== hits[1].seat.blockKey)
    return { ambiguous: true };
  return { blockKey: hits[0].seat.blockKey };
}
