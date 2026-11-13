/** Source-diagram choices have their own namespace. They never identify a
 * physical seat, simulation layout, photo or current production configuration. */
const SCHEMA = 'theater-source-plan-choice/v1';
const PREFIX = 'theater3d-portfolio.source-seat-choice.v1:';
const text = value => typeof value === 'string' && value.trim() && value.length <= 300;
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function context(plan) {
  const c = plan?.selectionContext;
  if (!plain(c) || !text(c.key) || !text(plan.informationRecordId)
      || c.informationRecordId !== plan.informationRecordId
      || !['source_layout', 'historical_production', 'dated_production'].includes(c.kind)
      || !/^[a-f0-9]{64}$/.test(plan.source?.inputSha256 || '')
      || !Array.isArray(plan.frames) || !plan.frames.length) return null;
  if (['historical_production', 'dated_production'].includes(c.kind)
      && (!c.key.startsWith('source-production:') || c.currentPermanentLayout !== false
          || c.partial !== true || !text(c.performanceTitle)
          || !/^\d{4}-\d{2}-\d{2}$/.test(c.start || '')
          || !/^\d{4}-\d{2}-\d{2}$/.test(c.end || '') || c.end < c.start)) return null;
  if (c.kind === 'source_layout' && !c.key.startsWith('source-plan:')) return null;
  return { informationRecordId: plan.informationRecordId, contextKey: c.key,
    kind: c.kind, sourceSha256: plan.source.inputSha256 };
}

export function sourcePlanChoiceKey(plan) {
  const c = context(plan);
  return c ? PREFIX + encodeURIComponent(c.informationRecordId) + ':' + encodeURIComponent(c.contextKey) : null;
}

/** Untrusted local JSON must match both version namespace and original-source
 * hash, and every frame/seat must still exist. No label guessing or ID mapping. */
export function normalizeSourcePlanChoice(plan, value) {
  const c = context(plan);
  if (!c || !plain(value) || value.schema !== SCHEMA
      || Object.entries(c).some(([key, expected]) => value[key] !== expected)
      || !text(value.frameId) || !Array.isArray(value.selections)
      || value.selections.length > plan.frames.length) return null;
  const frames = new Map(plan.frames.map(frame => [frame.id, frame]));
  if (!frames.has(value.frameId)) return null;
  const seen = new Set(), selections = [];
  for (const entry of value.selections) {
    if (!plain(entry) || !text(entry.frameId) || !text(entry.seatId)
        || seen.has(entry.frameId) || !frames.get(entry.frameId)?.seats.some(seat => seat.id === entry.seatId)) return null;
    seen.add(entry.frameId); selections.push({ frameId: entry.frameId, seatId: entry.seatId });
  }
  return { schema: SCHEMA, ...c, frameId: value.frameId, selections };
}

export function snapshotSourcePlanChoice(plan, { frameId, selectedByFrame } = {}) {
  const c = context(plan);
  if (!c || !(selectedByFrame instanceof Map)) return null;
  return normalizeSourcePlanChoice(plan, { schema: SCHEMA, ...c, frameId,
    selections: [...selectedByFrame].map(([id, seatId]) => ({ frameId: id, seatId })) });
}

export function readSourcePlanChoice(plan, storage) {
  const key = sourcePlanChoiceKey(plan);
  if (!key || !storage) return null;
  try {
    if (typeof storage.getItem !== 'function') return null;
    const raw = storage.getItem(key);
    return typeof raw === 'string' && raw.length <= 65536
      ? normalizeSourcePlanChoice(plan, JSON.parse(raw)) : null;
  } catch { return null; }
}

export function writeSourcePlanChoice(plan, choice, storage) {
  const key = sourcePlanChoiceKey(plan), normalized = normalizeSourcePlanChoice(plan, choice);
  if (!key || !normalized || !storage) return false;
  try { if (typeof storage.setItem !== 'function') return false; storage.setItem(key, JSON.stringify(normalized)); return true; }
  catch { return false; }
}
