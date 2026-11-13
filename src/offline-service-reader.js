import { isValidatedOfflineServiceBundle } from './offline-service-bundle.js';

const reject = code => {
  const error = new Error(code);
  error.name = 'OfflineServiceReaderError';
  error.code = code;
  throw error;
};

function freezeJSON(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeJSON(item);
    Object.freeze(value);
  }
  return value;
}

// Every output is detached from the validated baseline. The validator's strict
// JSON contract excludes accessors, prototypes, cycles and credentials first.
const detached = value => freezeJSON(structuredClone(value));
const queryId = value => {
  if (typeof value !== 'string' || !value || value.trim() !== value
      || value.length > 300 || /[\u0000-\u001f\u007f]/u.test(value)) reject('INVALID_QUERY');
  return value;
};

/** Read-only access to one already validated local snapshot.
 * No export/authentication decision, online provider, fallback, persistence,
 * password verification or photo replacement is supplied by this adapter. */
export function createOfflineServiceReader(snapshot) {
  if (!isValidatedOfflineServiceBundle(snapshot)) reject('UNVALIDATED_BUNDLE');

  const { manifest, records } = snapshot;
  const layouts = new Map(records.layouts.map(record => [record.id, record]));
  const seats = new Map(records.seats.map(record => [record.id, record]));
  const posts = new Map(records.posts.map(record => [record.id, record]));
  const photos = new Map(records.photos.map(record => [record.id, record]));
  const assets = new Map(manifest.assets.map(record => [record.id, record]));
  const requireRecord = (index, id) => {
    const record = index.get(queryId(id));
    if (!record) reject('NOT_FOUND');
    return record;
  };

  return Object.freeze({
    snapshotInfo() {
      return detached({ manifest, counts: {
        layouts: records.layouts.length, seats: records.seats.length,
        posts: records.posts.length, photos: records.photos.length,
      } });
    },
    listLayouts() { return detached(records.layouts); },
    listSeats(layoutId) {
      requireRecord(layouts, layoutId);
      return detached(records.seats.filter(record => record.layoutId === layoutId));
    },
    listPosts(seatId) {
      requireRecord(seats, seatId);
      return detached(records.posts.filter(record => record.seatId === seatId));
    },
    listPhotos(postId) {
      requireRecord(posts, postId);
      return detached(records.photos.filter(record => record.postId === postId));
    },
    readPhoto(photoId) {
      const photo = requireRecord(photos, photoId);
      const asset = requireRecord(assets, photo.assetId);
      // This extra copy also isolates two callers from each other's edits.
      const bytes = new Uint8Array(snapshot.readAsset(asset.id));
      return Object.freeze({ photo: detached(photo), asset: detached(asset), bytes });
    },
  });
}
