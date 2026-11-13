const EPSILON = 1e-8;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cross = (a, b) => a.x * b.z - a.z * b.x;
const dot = (a, b) => a.x * b.x + a.z * b.z;
const subtract = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const along = (axis, distance) => ({ x: axis.origin.x + axis.direction.x * distance, z: axis.origin.z + axis.direction.z * distance });

function polygonCentroid(polygon) {
  let twiceArea = 0, x = 0, z = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length], weight = cross(a, b);
    twiceArea += weight; x += (a.x + b.x) * weight; z += (a.z + b.z) * weight;
  }
  const center = Math.abs(twiceArea) > EPSILON ? { x: x / (3 * twiceArea), z: z / (3 * twiceArea) } : null;
  return center && finite(center.x) && finite(center.z) ? center : null;
}

function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], delta = subtract(b, a), offset = subtract(point, a);
    if (dot(delta, delta) > EPSILON * EPSILON && Math.abs(cross(delta, offset)) <= EPSILON && dot(offset, delta) >= -EPSILON && dot(offset, delta) <= dot(delta, delta) + EPSILON) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Intersect an infinite horizontal line with a possibly concave stage outline. */
function polygonIntervals(polygon, axis) {
  const intersections = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const da = cross(axis.direction, subtract(a, axis.origin)), db = cross(axis.direction, subtract(b, axis.origin));
    if (Math.abs(da) <= EPSILON) intersections.push(dot(subtract(a, axis.origin), axis.direction));
    if (Math.abs(db) <= EPSILON) intersections.push(dot(subtract(b, axis.origin), axis.direction));
    if (da * db < -EPSILON * EPSILON) {
      const fraction = da / (da - db), point = { x: a.x + (b.x - a.x) * fraction, z: a.z + (b.z - a.z) * fraction };
      intersections.push(dot(subtract(point, axis.origin), axis.direction));
    }
  }
  intersections.sort((a, b) => a - b);
  const unique = intersections.filter((distance, index) => !index || Math.abs(distance - intersections[index - 1]) > EPSILON);
  const result = [];
  for (let index = 0; index < unique.length - 1; index++) {
    const startM = unique[index], endM = unique[index + 1];
    if (endM - startM > EPSILON && insidePolygon(along(axis, (startM + endM) / 2), polygon)) result.push({ startM, endM });
  }
  return result;
}

function rectangleInterval(rectangle, axis) {
  let startM = -Infinity, endM = Infinity;
  for (const [coordinate, min, max] of [['x', rectangle.xMin, rectangle.xMax], ['z', rectangle.zStart, rectangle.zEnd]]) {
    const origin = axis.origin[coordinate], direction = axis.direction[coordinate];
    if (Math.abs(direction) <= EPSILON) { if (origin < min - EPSILON || origin > max + EPSILON) return null; continue; }
    const distances = [(min - origin) / direction, (max - origin) / direction].sort((a, b) => a - b);
    startM = Math.max(startM, distances[0]); endM = Math.min(endM, distances[1]);
    if (endM - startM <= EPSILON) return null;
  }
  return finite(startM) && finite(endM) ? { startM, endM } : null;
}

// Cross-sections of the same display chair/torso dimensions used by scene.js.
// They are model symbols, not newly surveyed body or auditorium dimensions.
function convexSection(points) {
  const unique = [...new Map(points.map(p => [`${p.distanceM.toFixed(7)}:${p.y.toFixed(7)}`, p])).values()]
    .sort((a, b) => a.distanceM - b.distanceM || a.y - b.y);
  if (unique.length < 3) return [];
  const turn = (a, b, c) => (b.distanceM - a.distanceM) * (c.y - a.y) - (b.y - a.y) * (c.distanceM - a.distanceM);
  const half = values => { const result = []; for (const p of values) { while (result.length > 1 && turn(result.at(-2), result.at(-1), p) <= EPSILON) result.pop(); result.push(p); } return result; };
  const hull = [...half(unique).slice(0, -1), ...half([...unique].reverse()).slice(0, -1)];
  return hull.length >= 3 ? hull : [];
}

function sliceFaces(faces, axis) {
  const points = [], normalDistance = p => cross(axis.direction, subtract(p, axis.origin));
  const add = p => points.push({ distanceM: dot(subtract(p, axis.origin), axis.direction), y: p.y });
  for (const face of faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length], da = normalDistance(a), db = normalDistance(b);
    if (Math.abs(da) <= EPSILON) add(a);
    if (da * db < -EPSILON * EPSILON) { const t = da / (da - db); add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }); }
  }
  return convexSection(points);
}

function seatedWorld(seat, x, y, z) {
  const angle = (finite(seat.rotationDeg) ? seat.rotationDeg : 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: seat.x + x * c + z * s, y: seat.floorY + y, z: seat.z - x * s + z * c };
}

function sliceBox(seat, axis, xMin, xMax, zMin, zMax, yMin, yMax) {
  const ring = y => [[xMin, zMin], [xMax, zMin], [xMax, zMax], [xMin, zMax]].map(([x, z]) => seatedWorld(seat, x, y, z));
  const lower = ring(yMin), upper = ring(yMax);
  return sliceFaces([lower, upper, ...lower.map((p, i) => [p, lower[(i + 1) % 4], upper[(i + 1) % 4], upper[i]])], axis);
}

function sectionChairs(geometry, axis, selectedSeat) {
  const width = finite(geometry.seatSpacingM) && geometry.seatSpacingM > 0 ? Math.min(geometry.seatSpacingM * .74, .45) : .45;
  return geometry.seats.filter(s => ['x', 'z', 'floorY'].every(k => finite(s[k]))).flatMap(s => {
    const polygons = [sliceBox(s, axis, -width / 2, width / 2, -.19, .19, .34, .46), sliceBox(s, axis, -width / 2, width / 2, .1075, .1925, .42, .77)].filter(p => p.length);
    return polygons.length ? [{ row: s.row, number: s.number, label: s.displayLabel || s.label || '', selected: s.row === selectedSeat.row && s.number === selectedSeat.number, floorY: s.floorY,
      distanceM: dot(subtract(s, axis.origin), axis.direction), polygons, dimensionsKind: 'existing_renderer_chair_symbol' }] : [];
  });
}

function sectionAudience(geometry, audience, axis, selectedSeat) {
  const result = [], ids = new Set();
  for (const person of Array.isArray(audience) ? audience : []) {
    if (!person || !text(person.id) || ids.has(person.id) || !finite(person.seatedHeadTopFromFloorM ?? person.heightM)) continue;
    const s = geometry.seats.find(s => s.row === person.seat?.row && s.number === person.seat?.number);
    if (!s || s.row === selectedSeat.row && s.number === selectedSeat.number || !['x', 'z', 'floorY'].every(k => finite(s[k]))) continue;
    const h = person.seatedHeadTopFromFloorM ?? person.heightM, seatY = person.seatHeightM;
    if (h < .65 || h > 2.5 || !finite(seatY) || seatY < .08 || seatY > h * .65) continue;
    const actual = { ...s, rotationDeg: finite(person.rotationDeg) ? person.rotationDeg : s.rotationDeg };
    const headRadius = h * .10, shoulderY = h - headRadius * 2 - .035, waistY = seatY + .05, hipWidth = h * .14, shoulderWidth = h * .17;
    const ring = (halfWidth, y, front, back) => [[-halfWidth, front], [halfWidth, front], [halfWidth, back], [-halfWidth, back]].map(([x, z]) => seatedWorld(actual, x, y, z));
    const lower = ring(hipWidth, waistY, -.075, .075), upper = ring(shoulderWidth, shoulderY, -.07, .065);
    const polygons = [sliceFaces([lower, upper, ...lower.map((p, i) => [p, lower[(i + 1) % 4], upper[(i + 1) % 4], upper[i]])], axis),
      sliceBox(actual, axis, -hipWidth, hipWidth, -.135, .095, seatY - .02, seatY + .08)].filter(p => p.length);
    const headCenter = seatedWorld(actual, 0, h - headRadius, 0), headOffset = cross(axis.direction, subtract(headCenter, axis.origin));
    const head = Math.abs(headOffset) < headRadius ? { distanceM: dot(subtract(headCenter, axis.origin), axis.direction), y: headCenter.y, radiusM: Math.sqrt(headRadius * headRadius - headOffset * headOffset) } : null;
    if (!polygons.length && !head) continue;
    ids.add(person.id); result.push({ id: person.id, row: s.row, number: s.number, floorY: s.floorY, headTopY: s.floorY + h,
      distanceM: dot(subtract(s, axis.origin), axis.direction), polygons, head, color: /^#[\da-f]{6}$/i.test(person.color || '') ? person.color : '#94a9bb',
      dimensionsKind: 'existing_renderer_seated_torso_head_symbol', crossPlaneToleranceM: 0 });
  }
  return result.sort((a, b) => a.distanceM - b.distanceM);
}

function sightlineIntersections(audience, eyeY, targetY, distance) {
  const slope = (targetY - eyeY) / distance, result = [];
  for (const person of audience) {
    const intervals = [];
    for (const polygon of person.polygons) {
      const crossings = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = a.y - eyeY - slope * a.distanceM, db = b.y - eyeY - slope * b.distanceM;
        if (Math.abs(da) <= EPSILON) crossings.push(a.distanceM);
        if (da * db < 0) crossings.push(a.distanceM + (b.distanceM - a.distanceM) * da / (da - db));
      }
      if (crossings.length >= 2) intervals.push([Math.min(...crossings), Math.max(...crossings)]);
    }
    if (person.head) {
      const h = person.head, offset = eyeY - h.y, a = 1 + slope * slope, b = 2 * (slope * offset - h.distanceM), c = h.distanceM * h.distanceM + offset * offset - h.radiusM * h.radiusM, discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) intervals.push([(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]);
    }
    for (const [start, end] of intervals) { const startM = Math.max(0, start), endM = Math.min(distance, end); if (endM - startM > EPSILON) result.push({ audienceId: person.id, startM, endM }); }
  }
  return result;
}

/**
 * A metric vertical section through the selected seat and the explicit target.
 * Source geometry is read without normalizeGeometry/defaults. Surface segments
 * appear only where the vertical plane intersects their actual footprints.
 * No observer/actor/object occlusion or camera-FOV prediction is made here.
 */
export function buildSightSection({ geometry, seat, eyeHeightM, people = [], audience = [], targetPersonId = null } = {}) {
  const base = {
    eligible: false, reason: null, reasonCode: null,
    selectedSeatKey: Number.isInteger(seat?.row) && Number.isInteger(seat?.number) ? `${seat.row}:${seat.number}` : '',
    targetKind: null, targetPersonId: null, angleDeg: null, eyeY: null, targetY: null, horizontalDistance: null,
    eye: null, target: null, axis: null, stageIntervals: [], rowPlatformIntervals: [], renderedPersonIds: [],
    sectionChairs: [], sectionAudience: [], sightlineAudienceIntersections: [], sightlineAudienceIds: [],
    profileCoverage: 'known_intersections_only', accuracy: 'model_geometry_not_field_measurement', occlusionCalculated: false,
    sightlineIntersectionKind: 'section_torso_head_symbols_only_not_full_visibility',
  };
  const unavailable = (reasonCode, reason) => ({ ...base, reasonCode, reason });
  if (!geometry || typeof geometry !== 'object') return unavailable('missing-geometry', '극장 좌표를 확인할 수 없습니다.');
  if (!finite(geometry.stageHeightM) || geometry.stageHeightM < 0) return unavailable('unknown-stage-height', '무대 바닥 높이를 확인할 수 없습니다.');
  if (!Array.isArray(geometry.stagePolygon) || geometry.stagePolygon.length < 3 || !geometry.stagePolygon.every(point => point && finite(point.x) && finite(point.z))) return unavailable('unknown-stage-outline', '무대 외곽 좌표를 확인할 수 없습니다.');
  const polygon = geometry.stagePolygon.map(point => ({ x: point.x, z: point.z })), center = polygonCentroid(polygon);
  if (!center) return unavailable('degenerate-stage-outline', '무대 외곽의 면적을 확인할 수 없습니다.');
  if (!Array.isArray(geometry.seats)) return unavailable('missing-seat-positions', '등록된 좌석 위치가 없습니다.');
  if (!Number.isInteger(seat?.row) || seat.row < 1 || !Number.isInteger(seat?.number) || seat.number < 1) return unavailable('unknown-seat-position', '선택 좌석의 식별자를 확인할 수 없습니다.');
  const matches = geometry.seats.filter(value => value?.row === seat?.row && value?.number === seat?.number);
  if (matches.length !== 1 || !['x', 'z', 'floorY'].every(field => finite(matches[0][field]))) return unavailable('unknown-seat-position', '선택 좌석의 위치·바닥 높이를 확인할 수 없습니다.');
  if (!finite(eyeHeightM) || eyeHeightM < 0) return unavailable('unknown-eye-height', '선택 좌석의 시점 높이를 확인할 수 없습니다.');
  if (!Array.isArray(geometry.rowPlatforms)) return unavailable('missing-row-platforms', '객석 단면 자료를 확인할 수 없습니다.');
  const positionedSeat = matches[0], eye = { x: positionedSeat.x, y: positionedSeat.floorY + eyeHeightM, z: positionedSeat.z,
    floorY: positionedSeat.floorY, eyeHeightM, label: positionedSeat.displayLabel || positionedSeat.label || base.selectedSeatKey };
  if (!finite(eye.y)) return unavailable('unknown-eye-height', '선택 좌석의 시점 높이를 계산할 수 없습니다.');
  let target, targetKind, resolvedPersonId = null;
  if (targetPersonId !== null) {
    const person = Array.isArray(people) ? people.find(value => value?.id === targetPersonId) : null;
    if (!person || !finite(person.x) || !finite(person.z)) return unavailable('unknown-target-person', '선택 인물의 위치를 확인할 수 없습니다.');
    const visualHeightM = finite(person.visualHeightM) && person.visualHeightM > 0 ? person.visualHeightM : person.heightM;
    if (!finite(visualHeightM) || visualHeightM <= 0 || !finite(geometry.stageHeightM + visualHeightM)) return unavailable('unknown-person-height', '선택 인물의 시각 높이를 확인할 수 없습니다.');
    if (!insidePolygon(person, polygon)) return unavailable('person-outside-stage', '선택 인물이 무대 외곽 안에 있지 않습니다.');
    target = { x: person.x, y: geometry.stageHeightM + visualHeightM / 2, z: person.z,
      floorY: geometry.stageHeightM, visualHeightM, label: '선택 인물 시각 높이의 중심', name: text(person.name) ? person.name : null };
    targetKind = 'person_center'; resolvedPersonId = person.id;
  } else {
    if (!insidePolygon(center, polygon)) return unavailable('stage-center-outside-outline', '무대 다각형의 중심이 외곽 안에 있지 않습니다.');
    target = { ...center, y: geometry.stageHeightM, label: '무대 다각형 중심 바닥' }; targetKind = 'stage_floor';
  }
  const delta = subtract(target, eye), horizontalDistance = Math.hypot(delta.x, delta.z);
  if (!finite(horizontalDistance) || horizontalDistance <= EPSILON) return unavailable('undefined-section-direction', '좌석과 목표 사이의 수평 방향을 정할 수 없습니다.');
  const axis = { origin: { x: eye.x, z: eye.z }, direction: { x: delta.x / horizontalDistance, z: delta.z / horizontalDistance }, unit: 'm' };
  const stageIntervals = polygonIntervals(polygon, axis).map(interval => ({ ...interval, y: geometry.stageHeightM }));
  if (!stageIntervals.length) return unavailable('stage-not-intersected', '이 방향에서 무대 단면을 확인할 수 없습니다.');
  const rowPlatformIntervals = [];
  for (const [sourceIndex, platform] of geometry.rowPlatforms.entries()) {
    if (!platform || !['xMin', 'xMax', 'zStart', 'zEnd'].every(field => finite(platform[field])) || platform.xMax <= platform.xMin || platform.zEnd <= platform.zStart) return unavailable('unknown-row-platform', '객석 단면의 경계를 확인할 수 없습니다.');
    const interval = rectangleInterval(platform, axis); if (!interval) continue;
    if (!finite(platform.y)) return unavailable('unknown-row-platform-height', '이 단면에 걸친 객석 바닥 높이를 확인할 수 없습니다.');
    rowPlatformIntervals.push({ ...interval, y: platform.y, row: Number.isInteger(platform.row) ? platform.row : null,
      rowLabel: text(platform.rowLabel) ? platform.rowLabel : null, sourceIndex });
  }
  rowPlatformIntervals.sort((a, b) => a.startM - b.startM || a.y - b.y);
  const angleDeg = Math.atan2(target.y - eye.y, horizontalDistance) * 180 / Math.PI;
  const chairs = sectionChairs(geometry, axis, seat), spectators = sectionAudience(geometry, audience, axis, seat);
  const intersections = sightlineIntersections(spectators, eye.y, target.y, horizontalDistance);
  return { ...base, eligible: true, eye, target, axis, stageIntervals, rowPlatformIntervals, targetKind,
    sectionChairs: chairs, sectionAudience: spectators, sightlineAudienceIntersections: intersections, sightlineAudienceIds: [...new Set(intersections.map(i => i.audienceId))],
    targetPersonId: resolvedPersonId, renderedPersonIds: resolvedPersonId === null ? [] : [resolvedPersonId],
    angleDeg, eyeY: eye.y, targetY: target.y, horizontalDistance,
    profileCoverage: rowPlatformIntervals.length ? 'known_intersections_only' : 'stage_and_viewpoint_only' };
}

// Display context only: project the whole existing symbol onto the section
// axis. It is separate from the exact cut polygons and never changes which
// people, chairs, platforms or sightline intersections belong to the section.
function sectionSymbolContext(section, geometry, audience) {
  const seats = new Map(geometry.seats.map(seat => [`${seat.row}:${seat.number}`, seat]));
  const people = Array.isArray(audience) ? audience : [];
  const [row, number] = section.selectedSeatKey.split(':').map(Number), selectedSeat = { row, number };
  const project = points => convexSection(points.map(point => ({ distanceM: dot(subtract(point, section.axis.origin), section.axis.direction), y: point.y })));
  const box = (seat, xMin, xMax, zMin, zMax, yMin, yMax) => project([yMin, yMax].flatMap(y =>
    [[xMin, zMin], [xMax, zMin], [xMax, zMax], [xMin, zMax]].map(([x, z]) => seatedWorld(seat, x, y, z))));
  const width = finite(geometry.seatSpacingM) && geometry.seatSpacingM > 0 ? Math.min(geometry.seatSpacingM * .74, .45) : .45;
  const chairs = section.sectionChairs.map(chair => {
    const seat = seats.get(`${chair.row}:${chair.number}`);
    return { row: chair.row, number: chair.number, polygons: [box(seat, -width / 2, width / 2, -.19, .19, .34, .46), box(seat, -width / 2, width / 2, .1075, .1925, .42, .77)] };
  });
  const spectators = section.sectionAudience.map(cut => {
    // Match the record that actually supplied this cut, including the existing
    // validation and duplicate-ID policy. Invalid/unused audience input must
    // not become a reference symbol or make an otherwise valid section fail.
    const person = people.find(value => value?.id === cut.id && JSON.stringify(sectionAudience(geometry, [value], section.axis, selectedSeat)[0]) === JSON.stringify(cut));
    const seat = seats.get(`${cut.row}:${cut.number}`);
    const actual = { ...seat, rotationDeg: finite(person.rotationDeg) ? person.rotationDeg : seat.rotationDeg };
    const h = person.seatedHeadTopFromFloorM ?? person.heightM, seatY = person.seatHeightM, radiusM = h * .10;
    const shoulderY = h - radiusM * 2 - .035, waistY = seatY + .05, hipWidth = h * .14, shoulderWidth = h * .17;
    const ring = (halfWidth, y, front, back) => [[-halfWidth, front], [halfWidth, front], [halfWidth, back], [-halfWidth, back]].map(([x, z]) => seatedWorld(actual, x, y, z));
    const center = seatedWorld(actual, 0, h - radiusM, 0);
    return { id: cut.id, polygons: [project([...ring(hipWidth, waistY, -.075, .075), ...ring(shoulderWidth, shoulderY, -.07, .065)]), box(actual, -hipWidth, hipWidth, -.135, .095, seatY - .02, seatY + .08)],
      head: { distanceM: dot(subtract(center, section.axis.origin), section.axis.direction), y: center.y, radiusM } };
  });
  return { chairs, audience: spectators };
}

function setDiagnostics(canvas, section) {
  if (!canvas?.dataset) return;
  const number = value => finite(value) ? String(value) : '';
  Object.assign(canvas.dataset, {
    selectedSeatKey: section.selectedSeatKey, targetKind: section.targetKind || '', targetPersonId: section.targetPersonId || '',
    angleDeg: number(section.angleDeg), eyeY: number(section.eyeY), targetY: number(section.targetY), horizontalDistance: number(section.horizontalDistance),
    eligible: String(section.eligible), reason: section.reason || '', reasonCode: section.reasonCode || '',
    sectionPersonIds: JSON.stringify(section.renderedPersonIds), stageIntervals: JSON.stringify(section.stageIntervals), rowPlatformIntervals: JSON.stringify(section.rowPlatformIntervals),
    sectionAudienceIds: JSON.stringify(section.sectionAudience.map(p => p.id)), sectionAudienceCount: String(section.sectionAudience.length),
    sectionChairCount: String(section.sectionChairs.length), sectionSightlineAudienceIds: JSON.stringify(section.sightlineAudienceIds),
    sectionSightlineIntersections: JSON.stringify(section.sightlineAudienceIntersections), sectionCrossPlaneToleranceM: '0',
    sectionAudienceShapeKind: section.sightlineIntersectionKind,
    sectionContextChairCount: '0', sectionContextAudienceCount: '0', sectionContextKind: '',
    sectionPlanePolicy: 'selected_seat_to_target_exact_cut', sectionPlatformPolicy: 'intersected_known_footprints_only_gaps_preserved',
    profileCoverage: section.profileCoverage, sectionKind: 'selected_seat_vertical_section', occlusionCalculated: 'false',
    sectionSelectedSeatKey: section.selectedSeatKey, sectionTargetKind: section.targetKind || '', sectionTargetPersonId: section.targetPersonId || '',
    sectionAngleDeg: number(section.angleDeg), sectionEyeY: number(section.eyeY), sectionTargetY: number(section.targetY), sectionHorizontalDistance: number(section.horizontalDistance),
    sectionSeatKey: section.selectedSeatKey, sectionDistanceM: number(section.horizontalDistance),
    sectionEligible: String(section.eligible), sectionReason: section.reason || '', sectionReasonCode: section.reasonCode || '',
  });
}

/** Render a vertical metric section; the second argument is raw build input. */
export function renderSightSection(canvas, params = {}) {
  const section = buildSightSection(params);
  const scene = { ...section, seatHits: [], stageObjectHits: [], personProjections: [], audienceProjections: [], audienceHits: [],
    structureProjections: [], structureHits: [], wallProjections: [], barrierProjections: [], editProjection: null };
  setDiagnostics(canvas, section);
  const rect = canvas?.getBoundingClientRect?.() || {}, width = Math.max(1, rect.width || canvas?.clientWidth || 960), height = Math.max(1, rect.height || canvas?.clientHeight || 480);
  const ctx = canvas?.getContext?.('2d'); if (!ctx) return { ...scene, error: '수직 단면을 그릴 수 없는 브라우저입니다.' };
  const dpr = clamp(finite(globalThis.devicePixelRatio) ? globalThis.devicePixelRatio : 1, 1, 3);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = typeof globalThis.getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
  const color = (key, fallback) => css?.getPropertyValue(key)?.trim() || fallback;
  const panel = color('--panel', '#fff'), ink = color('--text', '#252b33'), muted = color('--muted', '#68727e'), line = color('--control-line', '#a9afb8');
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = panel; ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle'; ctx.font = '12px system-ui'; ctx.fillStyle = ink;
  if (!section.eligible) {
    ctx.textAlign = 'center'; ctx.fillText(section.reason, width / 2, height / 2);
    canvas.setAttribute?.('aria-label', `수직 단면 사용 불가. ${section.reason}`); return { ...scene, error: section.reason };
  }
  const context = sectionSymbolContext(section, params.geometry, params.audience);
  Object.assign(canvas.dataset, { sectionContextChairCount: String(context.chairs.length), sectionContextAudienceCount: String(context.audience.length), sectionContextKind: 'whole_symbol_projection_for_intersected_cut_only' });
  const surfaces = [...section.stageIntervals, ...section.rowPlatformIntervals];
  const symbols = [...section.sectionChairs.flatMap(p => p.polygons.flat()), ...section.sectionAudience.flatMap(p => p.polygons.flat())];
  const references = [...context.chairs.flatMap(symbol => symbol.polygons.flat()), ...context.audience.flatMap(symbol => symbol.polygons.flat()),
    ...context.audience.flatMap(symbol => [{ distanceM: symbol.head.distanceM - symbol.head.radiusM, y: symbol.head.y - symbol.head.radiusM }, { distanceM: symbol.head.distanceM + symbol.head.radiusM, y: symbol.head.y + symbol.head.radiusM }])];
  const distances = [0, section.horizontalDistance, ...surfaces.flatMap(surface => [surface.startM, surface.endM]), ...symbols.map(p => p.distanceM), ...references.map(p => p.distanceM)];
  const heights = [0, section.eye.floorY, section.eyeY, section.targetY, ...surfaces.map(surface => surface.y), ...section.sectionAudience.map(p => p.headTopY), ...symbols.map(p => p.y), ...references.map(p => p.y)];
  if (section.targetKind === 'person_center') heights.push(section.target.floorY + section.target.visualHeightM);
  const xMin = Math.min(...distances) - .5, xMax = Math.max(...distances) + .5, yMin = Math.min(...heights) - .25, yMax = Math.max(...heights) + .35;
  const pad = { left: width < 480 ? 26 : 48, right: width < 480 ? 14 : 24, top: 88, bottom: 54 }, plotWidth = Math.max(1, width - pad.left - pad.right), plotHeight = Math.max(1, height - pad.top - pad.bottom);
  // Equal metric scale on both axes keeps the drawn slope equal to atan2.
  const scale = Math.min(plotWidth / Math.max(.1, xMax - xMin), plotHeight / Math.max(.1, yMax - yMin));
  const originX = pad.left + (plotWidth - (xMax - xMin) * scale) / 2 - xMin * scale;
  const originY = pad.top + (plotHeight - (yMax - yMin) * scale) / 2 + yMax * scale;
  const map = (distance, y) => ({ x: originX + distance * scale, y: originY - y * scale });
  const stroke = (a, b, style, weight = 1, dash = []) => { ctx.beginPath(); ctx.setLineDash(dash); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = style; ctx.lineWidth = weight; ctx.stroke(); ctx.setLineDash([]); };
  const polygon = (points, fill, edge, weight = 1) => {
    if (points.length < 3) return; ctx.beginPath();
    points.forEach((p, i) => { const q = map(p.distanceM, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = weight; ctx.stroke();
  };
  const eye = map(0, section.eyeY), floor = map(0, section.eye.floorY), target = map(section.horizontalDistance, section.targetY);
  const displayBaseY = Math.min(0, section.eye.floorY, ...surfaces.map(p => p.y));
  // Fill only each intersected known footprint. Gaps remain gaps; no new
  // continuous floor, riser spacing or architectural slab thickness is inferred.
  for (const platform of section.rowPlatformIntervals) {
    polygon([{ distanceM: platform.startM, y: displayBaseY }, { distanceM: platform.endM, y: displayBaseY }, { distanceM: platform.endM, y: platform.y }, { distanceM: platform.startM, y: platform.y }], '#d9dee4', '#89939e', .7);
    stroke(map(platform.startM, platform.y), map(platform.endM, platform.y), '#687580', 2.2);
  }
  // A riser is drawn only where two known platform edges actually meet.
  for (let i = 0; i < section.rowPlatformIntervals.length; i++) for (let j = i + 1; j < section.rowPlatformIntervals.length; j++) {
    const a = section.rowPlatformIntervals[i], b = section.rowPlatformIntervals[j];
    if (Math.abs(a.endM - b.startM) <= EPSILON && a.y !== b.y) stroke(map(a.endM, a.y), map(b.startM, b.y), muted, 1.5);
  }
  for (const stage of section.stageIntervals) {
    polygon([{ distanceM: stage.startM, y: displayBaseY }, { distanceM: stage.endM, y: displayBaseY }, { distanceM: stage.endM, y: stage.y }, { distanceM: stage.startM, y: stage.y }], '#c8cdd3', ink, 1);
    stroke(map(stage.startM, stage.y), map(stage.endM, stage.y), ink, 3);
  }
  // A literal cut can leave only a torso corner or miss a head. Its faint,
  // dashed whole-symbol context explains that fragment without widening the
  // plane or using a projected reference shape for visibility calculations.
  ctx.setLineDash([4, 3]);
  for (const symbol of [...context.chairs, ...context.audience]) {
    for (const points of symbol.polygons) polygon(points, 'rgba(148,169,187,0.10)', muted, .8);
    if (symbol.head) { const center = map(symbol.head.distanceM, symbol.head.y); ctx.beginPath(); ctx.arc(center.x, center.y, symbol.head.radiusM * scale, 0, Math.PI * 2); ctx.fillStyle = 'rgba(148,169,187,0.10)'; ctx.fill(); ctx.strokeStyle = muted; ctx.lineWidth = .8; ctx.stroke(); }
  }
  ctx.setLineDash([]);
  for (const chair of section.sectionChairs) for (const points of chair.polygons) polygon(points, chair.selected ? '#333b43' : '#c0c8d0', chair.selected ? ink : '#7c8793', chair.selected ? 1.4 : .7);
  for (const person of section.sectionAudience) {
    for (const points of person.polygons) polygon(points, person.color, '#52606b', .8);
    if (person.head) { const center = map(person.head.distanceM, person.head.y); ctx.beginPath(); ctx.arc(center.x, center.y, Math.max(.3, person.head.radiusM * scale), 0, Math.PI * 2); ctx.fillStyle = person.color; ctx.fill(); ctx.strokeStyle = '#52606b'; ctx.lineWidth = .8; ctx.stroke(); }
  }
  stroke(floor, eye, muted, 2); stroke(eye, map(section.horizontalDistance, section.eyeY), line, 1, [5, 4]);
  if (section.targetKind === 'person_center') {
    stroke(map(section.horizontalDistance, section.target.floorY), map(section.horizontalDistance, section.target.floorY + section.target.visualHeightM), muted, 5);
  }
  stroke(eye, target, ink, 2);
  for (const overlap of section.sightlineAudienceIntersections) {
    const yAt = distance => section.eyeY + (section.targetY - section.eyeY) * distance / section.horizontalDistance;
    stroke(map(overlap.startM, yAt(overlap.startM)), map(overlap.endM, yAt(overlap.endM)), '#b33c37', 3.5);
  }
  for (const point of [eye, target]) { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill(); }
  const signedAngle = `${section.angleDeg >= 0 ? '+' : ''}${section.angleDeg.toFixed(1)}°`, direction = Math.abs(section.angleDeg) < .000001 ? '수평' : section.angleDeg > 0 ? '상향' : '하향';
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.font = '600 14px system-ui'; ctx.fillText(`모델 기준 각도 ${signedAngle} · ${direction}`, 16, 22);
  ctx.font = '11px system-ui'; ctx.fillStyle = muted; ctx.fillText(`선택 좌석 → ${section.targetKind === 'person_center' ? '선택 배우' : '무대 중심'} · 관객 ${section.sectionAudience.length}명`, 16, 43);
  ctx.font = '10px system-ui'; ctx.fillText('실선: 실제 단면 · 점선: 걸친 기호의 전체 윤곽 참고', 16, 58);
  ctx.fillText('좌석마다 단면이 달라집니다. 통로의 빈 부분은 유지합니다.', 16, 73);
  ctx.textAlign = 'center'; ctx.fillStyle = ink; ctx.fillText('선택 좌석의 시점', clamp(eye.x, 70, width - 70), clamp(eye.y - 20, 64, height - 34));
  ctx.fillStyle = muted; ctx.fillText(`시점 높이 ${section.eyeY.toFixed(2)} m`, clamp(eye.x, 70, width - 70), clamp(floor.y + 20, 84, height - 26));
  ctx.fillText(`목표 높이 ${section.targetY.toFixed(2)} m`, clamp(target.x, 70, width - 70), clamp(target.y + 22, 84, height - 26));
  ctx.fillText(`수평거리 ${section.horizontalDistance.toFixed(2)} m`, width / 2, height - 18);
  if (section.profileCoverage === 'stage_and_viewpoint_only') { ctx.textAlign = 'right'; ctx.fillText('바닥선 없음 · 좌석 높이 표시', width - 14, height - 37); }
  canvas.setAttribute?.('aria-label', `선택 좌석에서 ${section.target.label}까지의 수직 단면. 모델 기준 각도 ${signedAngle}, ${direction}. 수평거리 ${section.horizontalDistance.toFixed(2)}미터. 단면 관객 ${section.sectionAudience.length}명, 관객 모형과 시선선 교차 ${section.sightlineAudienceIds.length}명. 전체 실제 시야 가림 판정은 아닙니다.`);
  const audienceProjections = section.sectionAudience.map(p => {
    const points = p.polygons.flat().map(q => map(q.distanceM, q.y));
    if (p.head) { const h = map(p.head.distanceM, p.head.y), radius = p.head.radiusM * scale; points.push({ x: h.x - radius, y: h.y - radius }, { x: h.x + radius, y: h.y + radius }); }
    const x = Math.min(...points.map(q => q.x)), y = Math.min(...points.map(q => q.y));
    return { id: p.id, row: p.row, number: p.number, visible: true, bounds: { x, y, width: Math.max(...points.map(q => q.x)) - x, height: Math.max(...points.map(q => q.y)) - y }, inVerticalSection: true };
  });
  return { ...scene, audienceProjections, viewport: { x: 0, y: 0, width, height }, sectionProjection: { scale, originX, originY, displayBaseY }, sectionDisplayContext: context };
}
