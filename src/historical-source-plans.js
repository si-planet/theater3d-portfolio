/** Public portfolio build: no real theatre or production records are shipped. */
export function normalizeHistoricalSourceRegistry() { return []; }
export function sourceProductionPresentation() {
  return { temporalClass: 'unavailable', temporalLabel: '데모 미제공', badge: '데모 미제공',
    period: '실제 공연 자료를 포함하지 않습니다.', directoryLabel: '데모 미제공' };
}
export function validateHistoricalSourcePlan() { throw new Error('HISTORICAL_DATA_DISABLED_IN_PORTFOLIO'); }
export function createHistoricalSourceLoader() {
  return { cancel() {}, async load() { throw new Error('HISTORICAL_DATA_DISABLED_IN_PORTFOLIO'); } };
}
