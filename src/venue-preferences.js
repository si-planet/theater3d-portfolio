export const VENUE_PREFERENCE_KEY = 'theater3d-portfolio.last-venue.v1';

const VENUE_PREFERENCE_VERSION = 1;
const DEFAULT_VENUE_ID = 'synthetic-portfolio-orbit-042';

function catalogIds(allowedVenueIds) {
  return Array.isArray(allowedVenueIds)
    ? allowedVenueIds.filter(id => typeof id === 'string' && id.length > 0)
    : [];
}

function getStorage(storage) {
  // Access the browser storage only inside the caller's try block: the
  // localStorage accessor itself can throw when browser storage is blocked.
  if (typeof storage === 'function') return storage();
  return storage === undefined ? globalThis.localStorage : storage;
}

export function loadVenuePreference({ allowedVenueIds, defaultVenueId = DEFAULT_VENUE_ID, storage } = {}) {
  const ids = catalogIds(allowedVenueIds);
  const fallback = ids.includes(defaultVenueId) ? defaultVenueId : ids[0] || DEFAULT_VENUE_ID;
  try {
    const stored = getStorage(storage).getItem(VENUE_PREFERENCE_KEY);
    if (stored === null || stored === undefined) return fallback;
    const preference = JSON.parse(stored);
    if (!preference || typeof preference !== 'object' || Array.isArray(preference)
      || preference.version !== VENUE_PREFERENCE_VERSION || !ids.includes(preference.venueId)) return fallback;
    return preference.venueId;
  } catch {
    return fallback;
  }
}

// Call only after a venue switch has completed. This module saves no other
// application state, including photographs, seats, people or camera settings.
export function saveVenuePreference({ venueId, allowedVenueIds, storage } = {}) {
  if (!catalogIds(allowedVenueIds).includes(venueId)) return false;
  try {
    getStorage(storage).setItem(VENUE_PREFERENCE_KEY, JSON.stringify({ version: VENUE_PREFERENCE_VERSION, venueId }));
    return true;
  } catch {
    return false;
  }
}
