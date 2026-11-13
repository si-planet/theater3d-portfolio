import { catalogError, catalogPathId, readCatalogPublic } from './catalog-repository.js';

/** Public derivatives only. Raw EXIF, filenames, owner and originals are rejected. */
export function createPhotoRepository({ transport } = {}) {
  if (!transport || typeof transport.request !== 'function') throw catalogError('BAD_REQUEST', 'Transport required');
  return Object.freeze({
    listPhotos: (options = {}) => readCatalogPublic(transport, 'photo', '/api/catalog/photos', options,
      ['venueId', 'layoutVersionId', 'seatId', 'workId', 'productionRunId', 'performanceEventId']),
    getPhoto: async (photoId, options = {}) => readCatalogPublic(transport, 'photo', `/api/catalog/photos/${catalogPathId(photoId)}`,
      options, [], { single: true, expectedId: photoId }),
  });
}
