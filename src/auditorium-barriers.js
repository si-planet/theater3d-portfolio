/**
 * Permanent auditorium barriers are independent of stage walls and set pieces.
 * Observed dimensions remain separate from their provisional display geometry.
 * This module deliberately has no geometry.js dependency: normalization calls it.
 */
export const SEATED_KNEE_GEOMETRY = Object.freeze({
  thighBackZ: -0.01,
  kneeZ: -0.31,
  thighBackYOffset: 0.02,
  kneeYOffset: -0.045,
  thighRadiusRatio: 0.041,
  shinFootY: 0.07,
  shinFootZ: -0.34,
  shinRadiusRatio: 0.035,
  radialSegments: 6,
});

const numeric = value => typeof value === 'number' && Number.isFinite(value);
const coordinate = value => numeric(value) && Math.abs(value) <= 1000;
const positive = (value, maximum) => numeric(value) && value > 0 && value <= maximum;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const TAU = Math.PI * 2;

/** Normalize only a supported, source-aware observation; invalid input draws nothing. */
export function normalizeAuditoriumBarriers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schemaVersion !== 2 || value.kind !== 'segmented_permanent_front_row_barrier') return null;
  const source = value.source, observed = value.observed, display = value.displayAssumptions;
  if (!source || source.type !== 'user_observation' || typeof source.id !== 'string' || !source.id
      || !observed || observed.heightM !== null || !positive(observed.thicknessM, 3)
      || !positive(observed.kneeClearanceM, 1)
      || observed.heightRelation !== 'similar_to_stage' || observed.seatedFaceVisible !== true
      || observed.segmented !== true || observed.frontFloor !== 'flat'
      || !display || display.heightRule !== 'match_current_model_stage_height'
      || display.heightSource !== 'geometry.stageHeightM_model_interpretation'
      || own(display, 'thicknessM')
      || !positive(display.referenceSeatedHeadTopM, 2.5) || display.referenceSeatedHeadTopM < 0.65
      || !positive(display.referenceSeatHeightM, display.referenceSeatedHeadTopM * 0.65)
      || display.referenceSeatHeightM < 0.08
      || display.referencePreset !== 'female'
      || !positive(display.endPaddingSeatPitchRatio, 1)
      || !positive(display.clusterGapSeatPitchRatio, 5) || display.clusterGapSeatPitchRatio <= 1
      || !/^#[0-9a-f]{6}$/i.test(display.color || '')) return null;
  const sectionLabels = Array.isArray(value.sectionLabels)
    ? [...new Set(value.sectionLabels.filter(label => typeof label === 'string' && /^[ABC]$/.test(label)))] : [];
  if (!sectionLabels.length) return null;
  const officialKeys = ['heightM', 'kneeClearanceM', 'thicknessM', 'color', 'spanM', 'gapLengthsM', 'coordinates'];
  // The observation contains no official survey. Never promote display values.
  const officialMeasurements = Object.fromEntries(officialKeys.map(key => [key, null]));
  return {
    ...value, sectionLabels,
    source: { ...source },
    observed: { ...observed, ...(observed.opConnection ? { opConnection: { ...observed.opConnection } } : {}) },
    officialMeasurements,
    displayAssumptions: { ...display },
  };
}

const vector = (x, y, z) => ({ x, y, z });
const cross = (a, b) => vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit = value => {
  const length = Math.hypot(value.x, value.y, value.z);
  return vector(value.x / length, value.y / length, value.z / length);
};

/** Match scene.js's actual six-sided cylinder cap at the anatomical knee joint. */
function cylinderFrontOffsetM(deltaY, deltaZ, radius) {
  const axis = unit(vector(0, deltaY, deltaZ));
  const reference = Math.abs(axis.y) < 0.9 ? vector(0, 1, 0) : vector(1, 0, 0);
  const u = unit(cross(axis, reference)), v = unit(cross(axis, u));
  return Math.min(...Array.from({ length: SEATED_KNEE_GEOMETRY.radialSegments }, (_, index) => {
    const angle = TAU * index / SEATED_KNEE_GEOMETRY.radialSegments;
    return (u.z * Math.cos(angle) + v.z * Math.sin(angle)) * radius;
  }));
}

/** Forward distance from seat centre to the knee surface, not the foot or seat front. */
export function seatedKneeForwardExtentM(headTopM, seatHeightM) {
  if (!positive(headTopM, 2.5) || headTopM < 0.65
      || !positive(seatHeightM, headTopM * 0.65) || seatHeightM < 0.08) return null;
  const k = SEATED_KNEE_GEOMETRY;
  const thigh = cylinderFrontOffsetM(k.kneeYOffset - k.thighBackYOffset,
    k.kneeZ - k.thighBackZ, headTopM * k.thighRadiusRatio);
  const shin = cylinderFrontOffsetM(k.shinFootY - (seatHeightM + k.kneeYOffset),
    k.shinFootZ - k.kneeZ, headTopM * k.shinRadiusRatio);
  return -(k.kneeZ + Math.min(thigh, shin));
}

function validSeat(seat) {
  return seat && ['x', 'z', 'floorY'].every(key => coordinate(seat[key]))
    && Number.isInteger(seat.physicalRow) && seat.physicalRow >= 1
    && Number.isInteger(seat.row) && seat.row >= 1
    && Number.isInteger(seat.number) && seat.number >= 1
    && (!own(seat, 'rotationDeg') || coordinate(seat.rotationDeg));
}

/**
 * Derive display spans from each section's first physical row. Keeping sections
 * separate preserves the existing aisles; a sparse cluster also leaves a break.
 * These spans are display assumptions, never a survey of the actual wall gaps.
 */
export function getAuditoriumBarriers(geometry = {}) {
  const descriptor = normalizeAuditoriumBarriers(geometry?.auditoriumBarriers);
  if (!descriptor || !Array.isArray(geometry?.seats) || !positive(geometry.seatSpacingM, 10)
      || !positive(geometry.stageHeightM, 1000)) return [];
  const { observed, displayAssumptions: display, source } = descriptor;
  const pitch = geometry.seatSpacingM;
  // The user's approximate height relation is not a measured wall height.
  // Derive display height from the current stage interpretation without storing
  // that number as an observed or official dimension.
  const heightM = geometry.stageHeightM;
  const kneeForwardM = seatedKneeForwardExtentM(display.referenceSeatedHeadTopM, display.referenceSeatHeightM);
  const rearFaceForwardM = kneeForwardM + observed.kneeClearanceM;
  const centerForwardM = rearFaceForwardM + observed.thicknessM / 2;
  const barriers = [];
  for (const section of descriptor.sectionLabels) {
    const sectionSeats = geometry.seats.filter(seat => validSeat(seat) && seat.rowLabel === section);
    if (!sectionSeats.length) continue;
    const firstPhysicalRow = Math.min(...sectionSeats.map(seat => seat.physicalRow));
    const firstRow = sectionSeats.filter(seat => seat.physicalRow === firstPhysicalRow);
    // The observation describes flat ground in front; do not manufacture a
    // platform or move an incompatible floor to make a barrier fit.
    if (!firstRow.length || firstRow.some(seat => Math.abs(seat.floorY) > 1e-7)) continue;
    const rotationDeg = firstRow[0].rotationDeg || 0;
    const angle = rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const localX = seat => seat.x * cos - seat.z * sin;
    const localZ = seat => seat.x * sin + seat.z * cos;
    const sorted = [...firstRow].sort((a, b) => localX(a) - localX(b));
    const clusters = [];
    for (const seat of sorted) {
      const cluster = clusters.at(-1), previous = cluster?.at(-1);
      if (!previous || localX(seat) - localX(previous) > pitch * display.clusterGapSeatPitchRatio
          || Math.abs(localZ(seat) - localZ(previous)) > pitch * 0.25
          || Math.abs((seat.rotationDeg || 0) - rotationDeg) > 1e-7) clusters.push([seat]);
      else cluster.push(seat);
    }
    for (const [index, cluster] of clusters.entries()) {
      // A differently oriented cluster needs its own seat-aligned projection.
      const clusterRotation = cluster[0].rotationDeg || 0;
      if (cluster.some(seat => Math.abs((seat.rotationDeg || 0) - clusterRotation) > 1e-7)) continue;
      const theta = clusterRotation * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
      const widthValues = cluster.map(seat => seat.x * c - seat.z * s);
      const depthValues = cluster.map(seat => seat.x * s + seat.z * c);
      const widthMin = Math.min(...widthValues) - pitch * display.endPaddingSeatPitchRatio;
      const widthMax = Math.max(...widthValues) + pitch * display.endPaddingSeatPitchRatio;
      const centerWidth = (widthMin + widthMax) / 2;
      const rowDepth = depthValues.reduce((sum, value) => sum + value, 0) / depthValues.length;
      const world = (width, depth) => ({ x: width * c + depth * s, z: -width * s + depth * c });
      const center = world(centerWidth, rowDepth - centerForwardM);
      const rearFace = {
        start: world(widthMin, rowDepth - rearFaceForwardM),
        end: world(widthMax, rowDepth - rearFaceForwardM),
      };
      barriers.push({
        id: `auditorium-barrier-${section}-${index + 1}`,
        name: `${section}구역 앞 낮은 고정벽`, section,
        ...center, floorY: cluster[0].floorY,
        widthM: widthMax - widthMin, depthM: observed.thicknessM,
        heightM, rotationDeg: clusterRotation, color: display.color,
        source: { ...source }, observed: { ...observed },
        officialMeasurements: { ...descriptor.officialMeasurements },
        assumptions: {
          ...display, sourceType: 'model_assumption',
          heightM, actualHeightM: null,
          kneeForwardM, rearFaceForwardM, centerForwardM,
          spanSource: 'existing_first_physical_row_seat_clusters',
          gapSource: 'existing_section_aisles_and_sparse_seat_clusters',
          actualSpanM: null, actualGapLengthsM: null,
        },
        rearFace, frontRow: firstPhysicalRow,
        frontRowSeats: cluster.map(seat => ({ row: seat.row, number: seat.number, label: seat.label })),
      });
    }
  }
  return barriers;
}
