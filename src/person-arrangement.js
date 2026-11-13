import { isPointOnStage, stageBounds } from './geometry.js';

const failure = (code, message) => ({ ok: false, positions: [], code, message });
const numeric = value => typeof value === 'number' && Number.isFinite(value);

function selection(people, ids, geometry) {
  if (!Array.isArray(people) || !Array.isArray(ids) || !ids.length
      || new Set(ids).size !== ids.length) return failure('invalid-selection', '배치할 인물을 선택하세요.');
  const selected = people.filter(person => ids.includes(person?.id));
  if (selected.length !== ids.length || new Set(selected.map(person => person.id)).size !== ids.length
      || selected.some(person => !numeric(person.x) || !numeric(person.z))) {
    return failure('invalid-selection', '선택한 인물의 위치를 확인하세요.');
  }
  if (!stageBounds(geometry)) return failure('missing-stage', '무대 경계가 없어 배치할 수 없습니다.');
  return selected;
}

function validate(positions, geometry) {
  if (positions.some(point => !numeric(point.x) || !numeric(point.z)
      || Math.abs(point.x) > 1000 || Math.abs(point.z) > 1000
      || !isPointOnStage(geometry, point.x, point.z))) {
    return failure('outside-stage', '배치가 무대 경계를 벗어납니다. 간격이나 위치를 조정하세요.');
  }
  return { ok: true, positions };
}

// Canonical order makes diagonal endpoints independent of checkbox/click order.
const pointOrder = (a, b) => a.x - b.x || a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function endpointLine(selected, axis) {
  if (axis !== 'diagonal') {
    const cross = axis === 'x' ? 'z' : 'x';
    const ordered = selected.map((person, index) => ({ person, index }))
      .sort((a, b) => a.person[axis] - b.person[axis] || a.index - b.index).map(item => item.person);
    const midpoint = (Math.min(...selected.map(person => person[cross])) + Math.max(...selected.map(person => person[cross]))) / 2;
    return { ordered, first: { ...ordered[0], [cross]: midpoint }, last: { ...ordered.at(-1), [cross]: midpoint } };
  }
  // Use the farthest actual pair. Equal-distance ties take the first pair in
  // x, z, id order. Interior actors follow their projection along that line.
  const canonical = [...selected].sort(pointOrder);
  let first = canonical[0], last = canonical[0], maximum = -1;
  for (let a = 0; a < canonical.length; a++) for (let b = a + 1; b < canonical.length; b++) {
    const distance = (canonical[b].x - canonical[a].x) ** 2 + (canonical[b].z - canonical[a].z) ** 2;
    if (distance > maximum) { maximum = distance; first = canonical[a]; last = canonical[b]; }
  }
  const projection = person => (person.x - first.x) * (last.x - first.x) + (person.z - first.z) * (last.z - first.z);
  const interior = canonical.filter(person => person.id !== first.id && person.id !== last.id)
    .sort((a, b) => projection(a) - projection(b) || pointOrder(a, b));
  return { ordered: [first, ...interior, last], first, last };
}

/** Fixed spacing keeps its legacy mean-centered x/z behavior. Endpoint spacing
 * preserves the chosen axis extent and aligns the other axis to its range
 * midpoint; diagonal spacing preserves the farthest actual endpoints.
 * Distances are center-to-center centimetres. Reject without clamping. */
export function planPersonArrangement({ people, ids, geometry, axis = 'x', spacingCm = 100, spacingMode = 'fixed' } = {}) {
  const selected = selection(people, ids, geometry);
  if (!Array.isArray(selected)) return selected;
  if (selected.length < 2) return failure('insufficient-selection', '일직선 배치에는 인물 두 명 이상이 필요합니다.');
  if (!(spacingMode === 'endpoints' ? ['x', 'z', 'diagonal'] : ['x', 'z']).includes(axis)) return failure('invalid-axis', '배치 방향을 확인하세요.');
  if (!['fixed', 'endpoints'].includes(spacingMode)) return failure('invalid-spacing-mode', '간격 배치 방식을 확인하세요.');
  const ordered = selected.map((person, index) => ({ person, index }))
    .sort((a, b) => a.person[axis] - b.person[axis] || a.index - b.index);
  if (spacingMode === 'endpoints') {
    const { first, last, ordered: lineOrder } = endpointLine(selected, axis);
    const distanceM = Math.hypot(last.x - first.x, last.z - first.z);
    if (distanceM === 0) return failure('coincident-endpoints', '양끝 인물의 위치가 같습니다. 양끝 위치를 나눈 뒤 배치하세요.');
    const intervals = selected.length - 1;
    const positions = lineOrder.map((person, index) => {
      if (index === 0) return { id: person.id, x: first.x, z: first.z };
      if (index === intervals) return { id: person.id, x: last.x, z: last.z };
      const fraction = index / intervals;
      return { id: person.id, x: first.x + (last.x - first.x) * fraction,
        z: first.z + (last.z - first.z) * fraction };
    });
    const result = validate(positions, geometry);
    return result.ok ? { ...result, measuredSpacingCm: distanceM / intervals * 100,
      endpoints: [first, last].map(person => ({ id: person.id, x: person.x, z: person.z })) } : result;
  }
  if (!numeric(spacingCm) || spacingCm <= 0) return failure('invalid-spacing', '중심 간 간격은 0보다 큰 cm 값이어야 합니다.');
  const center = { x: selected.reduce((sum, person) => sum + person.x, 0) / selected.length,
    z: selected.reduce((sum, person) => sum + person.z, 0) / selected.length };
  const result = validate(ordered.map(({ person }, index) => ({ id: person.id, ...center,
    [axis]: center[axis] + (index - (selected.length - 1) / 2) * spacingCm / 100 })), geometry);
  return result.ok ? { ...result, measuredSpacingCm: spacingCm } : result;
}

/** Always calculate from the caller's start snapshot; never mutate it. */
export function planPersonTranslation({ people, ids, geometry, delta } = {}) {
  const selected = selection(people, ids, geometry);
  if (!Array.isArray(selected)) return selected;
  if (!delta || !numeric(delta.x) || !numeric(delta.z)) return failure('invalid-delta', '이동 거리를 확인하세요.');
  return validate(selected.map(person => ({ id: person.id, x: person.x + delta.x, z: person.z + delta.z })), geometry);
}
