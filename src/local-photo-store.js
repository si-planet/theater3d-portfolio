const STORE = 'photos';
const VERSION = 1;
const FIELDS = ['schemaVersion', 'id', 'name', 'type', 'lastModified', 'original', 'metadata', 'metadataSources', 'metadataStatus', 'metadataNotes', 'manualFields', 'seatContext', 'savedAt'];
const ok = value => ({ ok: true, value, issues: [] });
const fail = (code, message) => ({ ok: false, issues: [{ code, message }] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max = 300) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const nullableTime = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0;
const dataObject = value => plain(value) && !Object.getOwnPropertySymbols(value).length
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor && descriptor.enumerable);

function validContext(value) {
  if (value === null) return true;
  if (!dataObject(value)) return false;
  if (value.kind === 'source2d') return ['informationRecordId', 'layoutVersionId', 'configurationKey', 'frameId', 'seatId'].every(key => text(value[key]))
    && ['venueName', 'seatLabel'].every(key => typeof value[key] === 'string' && value[key].length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value[key]));
  if (value.kind !== undefined && value.kind !== 'legacy') return false;
  return ['venueId', 'modelId', 'seatId'].every(key => text(value[key]))
    && (text(value.modelVersion) || typeof value.modelVersion === 'number' && Number.isSafeInteger(value.modelVersion) && value.modelVersion >= 0)
    && ['venueName', 'seatLabel'].every(key => text(value[key], 500))
    && (value.source === undefined || value.source === 'user_selected')
    && ['layoutVersionId', 'productionRunId'].every(key => value[key] === undefined || text(value[key]));
}

function captureRecord(value, code = 'INVALID_RECORD') {
  try {
    if (!dataObject(value) || Object.keys(value).some(key => !FIELDS.includes(key)) || FIELDS.some(key => !Object.hasOwn(value, key))
      || value.schemaVersion !== 1 || !text(value.id) || typeof value.name !== 'string' || value.name.length > 2000
      || typeof value.type !== 'string' || value.type.length > 500 || !nullableTime(value.lastModified)
      || !dataObject(value.metadata) || !dataObject(value.metadataSources) || !text(value.metadataStatus, 100)
      || !Array.isArray(value.metadataNotes) || !value.metadataNotes.every(note => typeof note === 'string')
      || !Array.isArray(value.manualFields) || !value.manualFields.every(field => text(field))
      || !validContext(value.seatContext)
      || !(text(value.savedAt, 100) || typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) && value.savedAt >= 0)) throw Error('record');
    // Native Blob brand check also accepts File and cross-realm Blob instances.
    Blob.prototype.slice.call(value.original, 0, 0);
    if (Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(value.original) <= 0) throw Error('empty original');
    // Capture metadata/context before opening the asynchronous database. No JSON
    // conversion, original replacement, EXIF inference or display asset substitution.
    return ok(structuredClone(value));
  } catch {
    return fail(code, code === 'CORRUPT_RECORD' ? '저장한 사진 기록의 형식이 올바르지 않습니다. 기존 데이터는 보존했습니다.' : '저장할 사진 원본과 기록의 형식을 확인해 주세요.');
  }
}

function storageIssue(error, fallback) {
  const name = error?.name;
  if (name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014) return fail('QUOTA_EXCEEDED', '브라우저 저장 공간이 부족합니다. 기존 저장본은 보존했습니다.');
  if (name === 'SecurityError' || name === 'NotAllowedError') return fail('SECURITY_ERROR', '브라우저에서 사진 저장소 접근을 허용하지 않았습니다.');
  if (name === 'VersionError') return fail('VERSION_ERROR', '더 새로운 사진 저장소 형식입니다. 기존 데이터는 변경하지 않았습니다.');
  if (name === 'NotFoundError') return fail('CORRUPT_STORE', '사진 저장소 구조를 확인할 수 없습니다. 기존 데이터는 변경하지 않았습니다.');
  return fail(fallback, ({ OPEN_FAILED: '사진 저장소를 열지 못했습니다.', READ_FAILED: '저장한 사진을 읽지 못했습니다. 기존 데이터는 보존했습니다.',
    WRITE_FAILED: '사진을 저장하지 못했습니다. 기존 저장본은 보존했습니다.', DELETE_FAILED: '저장한 사진을 삭제하지 못했습니다.',
    CLOSE_FAILED: '사진 저장소 연결을 닫지 못했습니다.' })[fallback] || '사진 저장소를 사용할 수 없습니다.');
}

/** Browser-local originals only. Each write commits one complete record atomically. */
export function createLocalPhotoStore(options = {}) {
  let factory, dbName, setupError = null, connection = null, opening = null, cancelOpening = null, closed = false;
  try {
    factory = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB;
    dbName = options.dbName === undefined ? 'theater3d-portfolio.local-photos.v1' : options.dbName;
    if (!text(dbName, 500)) setupError = fail('INVALID_OPTIONS', '사진 저장소 이름을 확인해 주세요.');
    else if (!factory || typeof factory.open !== 'function') setupError = fail('UNAVAILABLE', '이 브라우저에서 사진 저장소를 사용할 수 없습니다.');
  } catch (error) { setupError = storageIssue(error, 'OPEN_FAILED'); }

  function open() {
    if (closed) return Promise.resolve(fail('CLOSED', '사진 저장소 연결이 종료되었습니다.'));
    if (setupError) return Promise.resolve(setupError);
    if (connection) return Promise.resolve(ok(connection));
    if (opening) return opening;
    const attempt = new Promise(resolve => {
      let request, done = false;
      const finish = result => { if (!done) { done = true; cancelOpening = null; resolve(result); } };
      cancelOpening = () => {
        finish(fail('CLOSED', '사진 저장소 연결이 종료되었습니다.'));
        try { request?.transaction?.abort(); } catch { /* A pending open has no abort API. */ }
      };
      try { request = factory.open(dbName, VERSION); }
      catch (error) { finish(storageIssue(error, 'OPEN_FAILED')); return; }
      request.onblocked = () => finish(fail('BLOCKED', '다른 탭이 사진 저장소 변경을 막고 있습니다. 기존 데이터는 변경하지 않았습니다.'));
      request.onerror = () => finish(storageIssue(request.error, 'OPEN_FAILED'));
      request.onupgradeneeded = () => {
        if (done || closed) { try { request.transaction.abort(); } catch { /* No destructive recovery. */ } return; }
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        } catch (error) { finish(storageIssue(error, 'OPEN_FAILED')); try { request.transaction.abort(); } catch { /* Preserve schema/data. */ } }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (done || closed) { try { db.close(); } catch { /* Late blocked/closed request owns only this connection. */ } return; }
        try {
          if (!db.objectStoreNames.contains(STORE)) throw Object.assign(Error(), { name: 'NotFoundError' });
          const transaction = db.transaction(STORE, 'readonly'), store = transaction.objectStore(STORE);
          transaction.onerror = () => {}; transaction.onabort = () => {};
          if (store.keyPath !== 'id' || store.autoIncrement) {
            db.close(); finish(fail('CORRUPT_STORE', '사진 저장소 구조가 올바르지 않습니다. 기존 데이터는 변경하지 않았습니다.')); return;
          }
          connection = db;
          db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
          db.onclose = () => { if (connection === db) connection = null; };
          finish(ok(db));
        } catch (error) { try { db.close(); } catch { /* Never delete a damaged store. */ } finish(storageIssue(error, 'OPEN_FAILED')); }
      };
    });
    opening = attempt;
    attempt.then(() => { if (opening === attempt) opening = null; });
    return attempt;
  }

  async function transaction(mode, action, failureCode) {
    const result = await open();
    if (!result.ok) return result;
    if (closed) return fail('CLOSED', '사진 저장소 연결이 종료되었습니다.');
    return new Promise(resolve => {
      let tx, request, value, requestError, done = false;
      const finish = result => { if (!done) { done = true; resolve(result); } };
      try {
        tx = result.value.transaction(STORE, mode);
        tx.oncomplete = () => finish(ok(value));
        tx.onabort = () => finish(storageIssue(requestError || tx.error, failureCode));
        tx.onerror = () => { requestError ||= tx.error; };
        request = action(tx.objectStore(STORE));
        request.onsuccess = () => { value = request.result; };
        request.onerror = () => { requestError = request.error; }; // Default abort preserves atomicity.
      } catch (error) {
        requestError = error;
        if (tx) { try { tx.abort(); } catch { finish(storageIssue(error, failureCode)); } }
        else finish(storageIssue(error, failureCode));
      }
    });
  }

  return {
    async list() {
      try {
        const result = await transaction('readonly', store => store.getAll(), 'READ_FAILED');
        if (!result.ok) return result;
        if (!Array.isArray(result.value)) return fail('CORRUPT_RECORD', '저장한 사진 목록의 형식이 올바르지 않습니다. 기존 데이터는 보존했습니다.');
        const records = [];
        for (const record of result.value) {
          const captured = captureRecord(record, 'CORRUPT_RECORD');
          if (!captured.ok) return captured;
          records.push(captured.value);
        }
        return ok(records);
      } catch (error) { return storageIssue(error, 'READ_FAILED'); }
    },
    async put(record) {
      const captured = captureRecord(record);
      if (!captured.ok) return captured;
      try {
        const result = await transaction('readwrite', store => store.put(captured.value), 'WRITE_FAILED');
        return result.ok ? ok(captured.value) : result;
      } catch (error) { return storageIssue(error, 'WRITE_FAILED'); }
    },
    async delete(id) {
      if (!text(id)) return fail('INVALID_RECORD', '삭제할 사진 ID를 확인해 주세요.');
      try {
        const result = await transaction('readwrite', store => store.delete(id), 'DELETE_FAILED');
        return result.ok ? ok(id) : result;
      } catch (error) { return storageIssue(error, 'DELETE_FAILED'); }
    },
    close() {
      closed = true; cancelOpening?.();
      try { connection?.close(); connection = null; return ok(null); }
      catch (error) { connection = null; return storageIssue(error, 'CLOSE_FAILED'); }
    },
  };
}
