const ID_FIELDS = ['informationRecordId', 'layoutVersionId', 'configurationKey', 'frameId', 'seatId'];
const LABEL_FIELDS = ['venueName', 'seatLabel'];
const controls = /[\u0000-\u001f\u007f]/;

/** Source identities are opaque values. Never derive one from a display label,
 * row, number or photo metadata, and never trim or truncate it into another ID. */
export function normalizeSeatMediaContext(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const field = key => descriptors[key] && Object.hasOwn(descriptors[key], 'value') ? descriptors[key].value : undefined;
    if (field('kind') !== 'source2d') return null;
    const result = { kind: 'source2d' };
    for (const key of ID_FIELDS) {
      const text = field(key);
      if (typeof text !== 'string' || !text || text.trim() !== text
          || text.length > 300 || controls.test(text)) return null;
      result[key] = text;
    }
    for (const key of LABEL_FIELDS) {
      const text = field(key);
      if (typeof text !== 'string' || text.length > 500) return null;
      result[key] = text;
    }
    return result;
  } catch { return null; }
}

/** The tag prevents overlap with legacy [venue, layout, row, number] notes. */
export function seatMediaContextKey(value) {
  const context = normalizeSeatMediaContext(value);
  return context ? JSON.stringify(['source2d', ...ID_FIELDS.map(key => context[key])]) : null;
}

export function sameSeatMediaContext(a, b) {
  const key = seatMediaContextKey(a);
  return key !== null && key === seatMediaContextKey(b);
}
