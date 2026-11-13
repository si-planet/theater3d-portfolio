import { catalogError, catalogPathId, readCatalogPublic } from './catalog-repository.js';

/** Delivery values expire; callers requery by asset ID. No persistence or retries. */
export function createAssetRepository({ transport } = {}) {
  if (!transport || typeof transport.request !== 'function') throw catalogError('BAD_REQUEST', 'Transport required');
  return Object.freeze({
    getDelivery: async (assetId, options = {}) => readCatalogPublic(transport, 'delivery', `/api/catalog/assets/${catalogPathId(assetId)}/delivery`,
      options, [], { single: true, expectedId: assetId }),
  });
}
