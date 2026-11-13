import { createSeatList, normalizeGeometry, seatPosition } from './geometry.js';

const STANDING_HEIGHT_SOURCE = Object.freeze({
  type: 'official_reference',
  url: 'https://www.kats.go.kr/content.do?cid=23007&cmsid=240&mode=view',
  period: '2020–2021',
  population: '한국인20–69세',
  measurement: 'standing_height',
});
const SEATED_DIMENSIONS_SOURCE = Object.freeze({
  type: 'model_assumption',
  note: '앉은 머리 높이·눈높이·좌면 높이와 몸통 분할은 시야 비교용 모델 가정이며 실측 평균이 아닙니다.',
});
const REFERENCE_NOTE = '평균 신장은 2020–2021년 한국인 20–69세 조사 참고값이며, 앉은 치수는 가정입니다.';

/** Standing height is a scoped survey reference; seated dimensions are assumptions. */
export const AUDIENCE_PRESETS = Object.freeze({
  male: Object.freeze({
    label: '남성 참고 체격', standingHeightM: 1.725,
    seatedHeadTopFromFloorM: 1.30, seatHeightM: 0.45, eyeHeightM: 1.20,
    color: '#88b5d8', standingHeightSource: STANDING_HEIGHT_SOURCE,
    seatedDimensionsSource: SEATED_DIMENSIONS_SOURCE, note: REFERENCE_NOTE,
  }),
  female: Object.freeze({
    label: '여성 참고 체격', standingHeightM: 1.596,
    seatedHeadTopFromFloorM: 1.23, seatHeightM: 0.45, eyeHeightM: 1.13,
    color: '#b6a2d8', standingHeightSource: STANDING_HEIGHT_SOURCE,
    seatedDimensionsSource: SEATED_DIMENSIONS_SOURCE, note: REFERENCE_NOTE,
  }),
});

function identifier(seat) {
  if (!seat || typeof seat !== 'object') return null;
  const positiveInteger = value => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
  return positiveInteger(seat.row) && positiveInteger(seat.number)
    ? { row: Number(seat.row), number: Number(seat.number) } : null;
}

const matchesSeat = (person, seat) => person?.seat?.row === seat.row && person?.seat?.number === seat.number;
const validLayout = layout => Boolean(layout && Array.isArray(layout.people));

/** Each geometry mode owns a separate layout in the caller. */
export function createAudienceLayout(_geometry) {
  return { people: [], excludedSeats: [] };
}

/** Personal visibility mask; occupants and official seats remain unchanged. */
export function getEffectiveAudience(layout) {
  if (!validLayout(layout)) return [];
  const excluded = new Set((layout.excludedSeats || []).map(s => `${s.row}:${s.number}`));
  return layout.people.filter(p => !excluded.has(`${p.seat?.row}:${p.seat?.number}`));
}

export function setAudienceExclusions(layout, geometry, seats) {
  if (!validLayout(layout) || !Array.isArray(seats) || seats.length > 10000 || !geometry) return false;
  const valid = new Set(createSeatList(normalizeGeometry(geometry)).map(s => `${s.row}:${s.number}`));
  const seen = new Set(), selected = [];
  for (const raw of seats) {
    const seat = identifier(raw), key = seat && `${seat.row}:${seat.number}`;
    if (!seat || !valid.has(key) || seen.has(key)) return false;
    seen.add(key); selected.push(seat);
  }
  layout.excludedSeats = selected;
  return true;
}

export function getAudienceAtSeat(layout, seat) {
  const selected = identifier(seat);
  if (!validLayout(layout) || !selected) return null;
  return layout.people.find(person => matchesSeat(person, selected)) || null;
}

function audiencePerson(mapped, preset) {
  const selected = { row: mapped.row, number: mapped.number };
  const reference = AUDIENCE_PRESETS[preset];
  return {
    id: `audience-${selected.row}-${selected.number}`,
    name: `${mapped.label} ${reference.label}`, seat: { ...selected }, preset,
    x: mapped.x, z: mapped.z, floorY: mapped.floorY,
    rotationDeg: mapped.rotationDeg ?? 0, pose: 'seated',
    heightM: reference.seatedHeadTopFromFloorM,
    standingHeightM: reference.standingHeightM,
    seatedHeadTopFromFloorM: reference.seatedHeadTopFromFloorM,
    seatHeightM: reference.seatHeightM, eyeHeightM: reference.eyeHeightM,
    color: reference.color, note: reference.note,
    standingHeightSource: { ...reference.standingHeightSource },
    seatedDimensionsSource: { ...reference.seatedDimensionsSource },
  };
}

/** Upsert only an exact seat in this model, never a clamped or missing number. */
export function setAudienceAtSeat(layout, geometry, seat, preset = 'male') {
  const selected = identifier(seat);
  if (!validLayout(layout) || !selected || !geometry || typeof geometry !== 'object' || Array.isArray(geometry)
      || typeof preset !== 'string' || !Object.prototype.hasOwnProperty.call(AUDIENCE_PRESETS, preset)) return false;
  const g = normalizeGeometry(geometry);
  const mapped = createSeatList(g).find(item => item.row === selected.row && item.number === selected.number);
  if (!mapped) return false;
  const position = seatPosition(g, selected, 0);
  if (!position) return false;
  const values = audiencePerson({ ...mapped, ...position }, preset);
  const existing = getAudienceAtSeat(layout, selected);
  if (existing) { Object.assign(existing, values); return existing; }
  layout.people.push(values);
  return values;
}

export function removeAudienceAtSeat(layout, seat) {
  const selected = identifier(seat);
  if (!validLayout(layout) || !selected) return false;
  const index = layout.people.findIndex(person => matchesSeat(person, selected));
  if (index < 0) return false;
  layout.people.splice(index, 1);
  return true;
}

export function clearAudience(layout) {
  if (!validLayout(layout)) return false;
  layout.people.length = 0;
  return layout;
}

function bulkAudienceSeats(layout, geometry, preset) {
  if (!validLayout(layout) || !geometry || typeof geometry !== 'object' || Array.isArray(geometry)
      || !['male', 'female', 'mixed'].includes(preset)) return null;
  const hasSeats = Object.prototype.hasOwnProperty.call(geometry, 'seats');
  if (hasSeats ? !Array.isArray(geometry.seats) : !identifier({ row: geometry.rowCount, number: geometry.seatsPerRow })) return null;
  return createSeatList(normalizeGeometry(geometry));
}

const presetForSeat = (preset, _seat, random = Math.random) => preset === 'mixed'
  ? (random() < .5 ? 'male' : 'female') : preset;

/** Replace the full audience atomically, leaving the viewer's exact seat empty. */
export function fillAudienceExceptSeat(layout, geometry, seat, preset = 'mixed') {
  const selected = identifier(seat);
  const seats = bulkAudienceSeats(layout, geometry, preset);
  if (!selected || !seats || !seats.some(item => item.row === selected.row && item.number === selected.number)) return false;
  const people = [];
  for (const mapped of seats) {
    if (mapped.row === selected.row && mapped.number === selected.number) continue;
    // Reuse the upsert's source-aware builder without scanning/normalizing the
    // full seat list again for each occupant.
    people.push(audiencePerson(mapped, presetForSeat(preset, mapped)));
  }
  layout.people = people;
  return layout;
}

/** Fill every mapped seat; the caller excludes its viewpoint only for rendering. */
export function fillAllAudience(layout, geometry, preset = 'mixed', random = Math.random) {
  const seats = bulkAudienceSeats(layout, geometry, preset);
  if (!seats || !seats.length) return false;
  const people = seats.map(mapped => audiencePerson(mapped, presetForSeat(preset, mapped, random)));
  // A refresh should produce a different arrangement even for a tiny model or
  // an injected random source that happens to repeat every previous choice.
  if (preset === 'mixed' && people.length && people.length === layout.people.length) {
    const previous = new Map(layout.people.map(person => [`${person.seat?.row}:${person.seat?.number}`,person.preset]));
    if (people.every(person => previous.get(`${person.seat.row}:${person.seat.number}`) === person.preset)) {
      const index=Math.min(people.length-1,Math.max(0,Math.floor(random()*people.length)));
      people[index]=audiencePerson(seats[index],people[index].preset==='male'?'female':'male');
    }
  }
  layout.people = people;
  return layout;
}

/** Change occupied seats only, retaining gaps and rejecting stale seats atomically. */
export function changeAudiencePreset(layout, geometry, preset = 'mixed') {
  const seats = bulkAudienceSeats(layout, geometry, preset);
  if (!seats || !seats.length) return false;
  const bySeat = new Map(seats.map(mapped => [`${mapped.row}:${mapped.number}`, mapped]));
  const occupied = new Set(), people = [];
  for (const person of layout.people) {
    const selected = identifier(person?.seat);
    if (!selected) return false;
    const key = `${selected.row}:${selected.number}`, mapped = bySeat.get(key);
    if (!mapped || occupied.has(key)) return false;
    occupied.add(key);
    const values = audiencePerson(mapped, presetForSeat(preset, mapped));
    // Retain occupant identity and extra per-seat annotations while refreshing
    // the preset's dimensions and their separate reference/assumption sources.
    people.push({ ...person, ...values, id: person.id ?? values.id });
  }
  layout.people = people;
  return layout;
}
