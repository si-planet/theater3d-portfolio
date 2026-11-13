const SCHEMA = 'theater-selection-availability/v1';
const KINDS = new Set(['model', 'plan', 'variant']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value);
const routeKey = (id, kind, key) => JSON.stringify([id, kind, key]);

/** Explicit review + a matching runtime route are required. Registration alone
 * never promotes an unreviewed source or a different configuration. */
export function createTheaterAvailability(input) {
  const accepted = new Set(), held = new Set();
  let valid = false;
  try {
    if (input?.schema !== SCHEMA || !Array.isArray(input.acceptedRoutes) || !Array.isArray(input.pendingReviews)) throw Error('review schema');
    for (const route of input.acceptedRoutes) {
      if (!text(route?.informationRecordId) || !KINDS.has(route.kind) || !text(route.key)) throw Error('review route');
      const key = routeKey(route.informationRecordId, route.kind, route.key);
      if (accepted.has(key)) throw Error('duplicate review route');
      accepted.add(key);
    }
    for (const review of input.pendingReviews) {
      if (!text(review?.informationRecordId) || review.state !== 'verification_pending' || held.has(review.informationRecordId)) throw Error('pending review');
      held.add(review.informationRecordId);
    }
    valid = true;
  } catch { accepted.clear(); held.clear(); }
  const isAccepted = (id, kind, key) => valid && !held.has(id) && accepted.has(routeKey(id, kind, key));
  function forRecord(record, { modelEntry, planEntry, variants = [] } = {}) {
    const id = record?.informationRecordId;
    if (record?.portfolioDisabled === true) return { selectable: false, state: 'demo_disabled', reason: '실제 극장 정보는 포함하지 않음' };
    if (!valid) return { selectable: false, state: 'review_unavailable', reason: '자료 확인 중' };
    if (held.has(id)) return { selectable: false, state: 'verification_pending', reason: '화면 확인 중' };
    const model = modelEntry?.informationRecordId === id && ['stage_ready', 'approximate_ready'].includes(modelEntry.status) && text(modelEntry.venueId);
    const plan = planEntry?.informationRecordId === id && text(planEntry.assetPath);
    const matchingVariants = variants.filter(variant => variant?.informationRecordId === id && text(variant.versionKey));
    const selectable = Boolean(
      (model && isAccepted(id, 'model', modelEntry.venueId)) ||
      (plan && isAccepted(id, 'plan', planEntry.assetPath)) ||
      matchingVariants.some(variant => isAccepted(id, 'variant', variant.versionKey))
    );
    return { selectable, state: selectable ? 'available' : model || plan || matchingVariants.length ? 'review_pending' : 'preparing',
      reason: selectable ? '' : model || plan || matchingVariants.length ? '자료 확인 중' : '자료 준비 중' };
  }
  return { isAccepted, forRecord };
}

/** Restoring an old pending selection only displays its pending state. It must
 * neither write the preference nor load a substitute model. */
export function theaterSelectionIntent(availability, { restoring = false } = {}) {
  return availability?.selectable === true ? 'open' : restoring ? 'preserve_pending' : 'reject';
}
