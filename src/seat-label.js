/**
 * Compare recognized seat-label hints without rewriting their displayed text.
 * A comparison key is not an official ID: callers must keep venue, layout,
 * floor/zone and row context. Never use it to merge photos or assign identities.
 */
export function seatLabelComparisonKey(label) {
  if (typeof label !== 'string' || !label || label.length > 100) return null;
  const normalized = label.normalize('NFC').trim().replace(/\s+/g, ' ');
  // Match the known filename-label grammar only. Explicit floor/zone values
  // stay in the key; their padding, case or omission cannot imply an alias.
  const match = /^((?:\d{1,3}층-)?(?:[a-z\d가-힣]{1,20}구역-)?)(?:([a-z]{1,3})(\d{1,3})|(\d{1,3})열 *(\d{1,3})번)$/i.exec(normalized);
  if (!match) return null;
  const [, prefix, letters, letterNumber, row, number] = match;
  return letters
    ? `${prefix}${letters.toUpperCase()}${Number(letterNumber)}`
    : `${prefix}${Number(row)}열${Number(number)}번`;
}

/** Equality only preserves an existing, explicitly selected seat context. */
export function sameSeatLabel(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left === right) return true;
  const leftKey = seatLabelComparisonKey(left);
  return leftKey !== null && leftKey === seatLabelComparisonKey(right);
}
