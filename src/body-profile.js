/** Adult population references and explicitly assumed stage silhouettes. */
export const DEFAULT_BODY_PRESET = 'male';

/** Consistent defaults for newly created adult reference figures only. */
export const BODY_PRESET_COLORS = Object.freeze({ female: '#ef9dbb', male: '#88c7f0' });
export function defaultBodyColor(bodyPreset) {
  return BODY_PRESET_COLORS[normalizeBodyPreset(bodyPreset)];
}

export const BODY_REFERENCE_SOURCE = Object.freeze({
  type: 'official_reference',
  url: 'https://www.kats.go.kr/content.do?cid=23007&cmsid=240&mode=view',
  title: '제8차 한국인 인체치수조사 결과 · 국가기술표준원',
  publishedOn: '2022-03-30',
  checkedOn: '2026-10-08',
  period: '2020–2021',
  measuredFrom: '2020-05',
  measuredThrough: '2021-12',
  population: '한국인 20–69세',
  sampleCount: 6839,
  measurement: 'mean_bmi_and_standing_height',
});

const POPULATION_WEIGHT_SOURCE = Object.freeze({
  type: 'official_reference',
  url: 'https://sizekorea.kr/support/file/f9928e0e3f704ea69795d3fb2b790f1f',
  postingUrl: 'https://sizekorea.kr/support/pds/view?bbsCntntsSeq=1326',
  title: '제8차 한국인 인체치수 조사 측정 결과 자료 · 통계자료 1~2차년도',
  publishedOn: '2021-12', checkedOn: '2026-10-08',
  population: '한국인 20–69세 직접측정 표본',
  measurement: 'direct_measurement_population_mean_weight',
  table: 'No. 125. 몸무게', printedPage: 125, pdfPage: 140,
});

export const BODY_PROFILE_NOTE = '한국인 20–69세 조사 평균 BMI로 계산한 키 기준 참고 체중·추정입니다. 공식 키별 평균 체중이 아니며, 어깨·허리·엉덩이와 얼굴 비율은 표시 가정입니다.';

const SHAPE_SOURCE = Object.freeze({
  type: 'model_assumption',
  note: '체형 비율과 BMI에 따른 너비 조정은 시야 비교용 표시 가정이며 공식 평균 인체치수나 체중에 맞춘 체적 측정값이 아닙니다.',
});

// Fractions of the selected standing height. These are rendering assumptions,
// not survey measurements. Reference BMI only provides a modest girth scale.
const COMMON_SHAPE = Object.freeze({
  // The official head/height index is 7.2–7.3; choosing its midpoint for this
  // silhouette is a model assumption, rather than a measured individual head.
  headHalfHeight: 1 / (2 * 7.25),
  headCenterY: 1 - 1 / (2 * 7.25),
  neckBottomY: 0.795,
  neckTopY: 0.881,
  shoulderY: 0.785,
  waistY: 0.58,
  hipY: 0.51,
  footLength: 0.145,
  footHeight: 0.028,
});

export const BODY_PRESETS = Object.freeze({
  male: Object.freeze({
    label: '남성 참고 체형', referenceBMI: 24.9, referenceHeightM: 1.725,
    populationMeanWeightKg: 74.53, directMeasuredSampleCount: 2319,
    referenceCrotchHeightRatio: 0.453,
    shapeRatios: Object.freeze({
      ...COMMON_SHAPE, crotchY: 0.453,
      shoulderHalfWidth: 0.132, waistHalfWidth: 0.092, hipHalfWidth: 0.095,
      torsoHalfDepth: 0.067, upperArmRadius: 0.034, forearmRadius: 0.027,
      thighRadius: 0.050, calfRadius: 0.034, neckRadius: 0.033,
      headHalfWidth: 0.047, headHalfDepth: 0.055,
    }),
  }),
  female: Object.freeze({
    label: '여성 참고 체형', referenceBMI: 22.6, referenceHeightM: 1.596,
    populationMeanWeightKg: 58.04, directMeasuredSampleCount: 2773,
    referenceCrotchHeightRatio: 0.458,
    shapeRatios: Object.freeze({
      ...COMMON_SHAPE, crotchY: 0.458,
      shoulderHalfWidth: 0.118, waistHalfWidth: 0.079, hipHalfWidth: 0.106,
      torsoHalfDepth: 0.060, upperArmRadius: 0.030, forearmRadius: 0.024,
      thighRadius: 0.053, calfRadius: 0.032, neckRadius: 0.030,
      headHalfWidth: 0.045, headHalfDepth: 0.053,
    }),
  }),
});

export function normalizeBodyPreset(value, fallback = DEFAULT_BODY_PRESET) {
  if (value === 'male' || value === 'female') return value;
  return fallback === 'male' || fallback === 'female' ? fallback : DEFAULT_BODY_PRESET;
}

function normalizedHeightM(value) {
  const numeric = value !== null && value !== undefined && value !== '' && typeof value !== 'boolean'
    && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value)) && Number(value) > 0;
  return numeric ? Math.max(0.3, Math.min(3, Number(value))) : 1.75;
}

const GIRTH_KEYS = new Set([
  'shoulderHalfWidth', 'waistHalfWidth', 'hipHalfWidth', 'torsoHalfDepth',
  'upperArmRadius', 'forearmRadius', 'thighRadius', 'calfRadius', 'neckRadius',
]);

/**
 * Keep the chosen standing height. BMI × height² is a derived reference weight,
 * not the measured average weight of people in that height bin. Shape ratios
 * stay deterministic for a preset and are independent of world position/pose.
 */
export function resolveBodyProfile({ heightM, bodyPreset } = {}) {
  const preset = normalizeBodyPreset(bodyPreset), reference = BODY_PRESETS[preset];
  const height = normalizedHeightM(heightM);
  const girthScale = Math.sqrt(reference.referenceBMI / 23.5);
  const shapeRatios = Object.fromEntries(Object.entries(reference.shapeRatios)
    .map(([key, ratio]) => [key, GIRTH_KEYS.has(key) ? ratio * girthScale : ratio]));
  return {
    bodyPreset: preset, label: reference.label, heightM: height,
    referenceWeightKg: reference.referenceBMI * height ** 2,
    referenceBMI: reference.referenceBMI, referenceHeightM: reference.referenceHeightM,
    officialWeightKg: null, heightBinMeanWeightKg: null,
    populationMeanWeightKg: reference.populationMeanWeightKg,
    populationWeightSource: { ...POPULATION_WEIGHT_SOURCE, sampleCount: reference.directMeasuredSampleCount },
    referenceBodyProportions: {
      type: 'official_reference', referenceSourceUrl: BODY_REFERENCE_SOURCE.url,
      headHeightIndexRange: [7.2, 7.3], crotchHeightRatio: reference.referenceCrotchHeightRatio,
    },
    source: { ...BODY_REFERENCE_SOURCE },
    weightSource: {
      type: 'model_estimate', formula: 'mean_bmi_times_height_squared',
      referenceSourceUrl: BODY_REFERENCE_SOURCE.url,
      measuredHeightBinMean: false,
      note: '조사 전체 성별 평균 BMI × 선택한 키(m)의 제곱으로 계산한 참고값입니다. 키 구간별 관측 평균이 아닙니다.',
    },
    shapeSource: { ...SHAPE_SOURCE, girthScale, girthScaleReferenceBMI: 23.5 },
    shapeRatios,
    note: BODY_PROFILE_NOTE,
  };
}
