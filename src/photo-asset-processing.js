import {claimPhotoProcessing,photoDecodeParts} from './photo-processing-resources.js';
import { parsePhotoMetadata } from './photo-metadata.js';

/** Browser-only local processing. Nothing is uploaded, published or persisted.
 * Original Blob identity/bytes are preserved. PNG derivatives contain freshly
 * encoded pixels only, without source EXIF/text. No Object URLs are allocated.
 */
export const PHOTO_ASSET_PROCESSING_VERSION = 1;
export const PHOTO_ASSET_LIMITS = Object.freeze({ maxBytes: 25 * 1024 * 1024, sourceMaxBytes: 64 * 1024 * 1024, maxPixels: 24000000, maxDimension: 8192, maxChunks: 4096, timeoutMs: 15000 });
class ProcessingError extends Error {
  constructor(code, message) { super(message); this.name = 'PhotoAssetProcessingError'; this.code = code; }
}
const issue = (code, message) => new ProcessingError(code, message);
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const abortCheck = signal => { if (signal?.aborted) throw issue('ABORTED', '이미지 처리를 취소했습니다.'); };
const finiteSize = value => Number.isSafeInteger(value) && value > 0 && value <= PHOTO_ASSET_LIMITS.maxDimension;
function dimensions(width, height) {
  if (!finiteSize(width) || !finiteSize(height) || width * height > PHOTO_ASSET_LIMITS.maxPixels) throw issue('EXCESSIVE_IMAGE', '브라우저는 24MP·한 변 8192px까지 지원합니다. 원본을 유지하고 기존 로컬 변환 도구로 FHD 사본을 만든 뒤 선택해 주세요.');
  return { width, height };
}
function format(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  throw issue('UNSUPPORTED_FORMAT', 'JPEG·PNG·WebP 이미지 바이트만 지원합니다.');
}
const corrupt = () => { throw issue('CORRUPT_IMAGE', '손상되거나 지원하지 않는 이미지 구조입니다.'); };
let crcTable;
function crc32(bytes) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
// Strip decoder-visible orientation metadata before applying our own transform:
// this avoids engine-dependent automatic EXIF rotation/double rotation.
function png(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [bytes.subarray(0, 8)];
  const exif = [];
  let offset = 8, size = null, ended = false, data = false, count = 0, hasMetadata = false;
  while (offset < bytes.length) {
    if (++count > PHOTO_ASSET_LIMITS.maxChunks || offset + 12 > bytes.length) corrupt();
    const length = view.getUint32(offset), kind = ascii(bytes, offset + 4, 4), end = offset + length + 12;
    if (length > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(kind)) corrupt();
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) corrupt();
    if (count === 1 && (kind !== 'IHDR' || length !== 13)) corrupt();
    if (kind === 'IHDR') { if (size || length !== 13) corrupt(); size = dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12)); }
    if (['acTL', 'fcTL', 'fdAT'].includes(kind)) throw issue('UNSUPPORTED_ANIMATION', '움직이는 이미지는 지원하지 않습니다.');
    if (kind === 'eXIf') exif.push(bytes.subarray(offset + 8, end - 4));
    if (kind === 'IDAT') data = true;
    if (kind === 'IEND') { if (length !== 0 || end !== bytes.length || !data) corrupt(); ended = true; }
    if (['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(kind)) hasMetadata = true;
    else parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!size || !ended) corrupt();
  return { ...size, parts, hasMetadata, exif };
}
function jpeg(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [bytes.subarray(0, 2)];
  const exif = [];
  let offset = 2, count = 0, size = null, scans = 0, ended = false;
  while (offset < bytes.length) {
    if (++count > PHOTO_ASSET_LIMITS.maxChunks || bytes[offset] !== 0xff) corrupt();
    const begin = offset;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) { if (!size || !scans || offset !== bytes.length) corrupt(); parts.push(bytes.subarray(begin, offset)); ended = true; break; }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) corrupt();
    if (offset + 2 > bytes.length) corrupt();
    const length = view.getUint16(offset), end = offset + length;
    if (length < 2 || end > bytes.length) corrupt();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size || length < 8 || bytes[offset + 2] !== 8) corrupt();
      size = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) corrupt();
    if (marker === 0xe1 && ascii(bytes, offset + 2, 6) === 'Exif\0\0') exif.push(bytes.subarray(offset + 8, end));
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(bytes.subarray(begin, end));
    offset = end;
    if (marker === 0xda) {
      scans++; const scanBegin = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        let next = offset + 1; while (bytes[next] === 0xff) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { offset = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(scanBegin, offset));
    }
  }
  if (!size || !ended) corrupt();
  return { ...size, parts, exif };
}
function webp(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) corrupt();
  const parts = [], exif = [], little24 = offset => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  let offset = 12, count = 0, size = null, imageSize = null, images = 0;
  while (offset < bytes.length) {
    if (++count > PHOTO_ASSET_LIMITS.maxChunks || offset + 8 > bytes.length) corrupt();
    const kind = ascii(bytes, offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8, end = start + length + (length & 1);
    if (length > bytes.length - start || end > bytes.length) corrupt();
    if (kind === 'EXIF') exif.push(bytes.subarray(start + (ascii(bytes, start, 6) === 'Exif\0\0' ? 6 : 0), start + length));
    if (['ANIM', 'ANMF'].includes(kind)) throw issue('UNSUPPORTED_ANIMATION', '움직이는 이미지는 지원하지 않습니다.');
    if (kind === 'VP8X') {
      if (size || length !== 10 || count !== 1 || bytes[start] & 0xc1 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) corrupt();
      if (bytes[start] & 2) throw issue('UNSUPPORTED_ANIMATION', '움직이는 이미지는 지원하지 않습니다.');
      size = dimensions(1 + little24(start + 4), 1 + little24(start + 7));
      const copy = bytes.slice(offset, end); copy[8] &= ~12; parts.push(copy);
    } else if (kind === 'VP8 ') {
      if (length < 10 || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') corrupt();
      imageSize = dimensions(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff); images++;
      parts.push(bytes.subarray(offset, end));
    } else if (kind === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f) corrupt();
      const bits = view.getUint32(start + 1, true);
      if (bits >>> 29) corrupt();
      imageSize = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); images++; parts.push(bytes.subarray(offset, end));
    } else if (!['EXIF', 'XMP '].includes(kind)) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (images !== 1 || !imageSize || (size && (size.width !== imageSize.width || size.height !== imageSize.height))) corrupt();
  const header = bytes.slice(0, 12); new DataView(header.buffer).setUint32(4, 4 + parts.reduce((sum, part) => sum + part.length, 0), true);
  return { ...(size || imageSize), parts: [header, ...parts], exif };
}

function checkedOrientation(blocks, parsed) {
  const values = [];
  for (const bytes of blocks) {
    const order = ascii(bytes, 0, 2), little = order === 'II';
    if (bytes.length < 8 || !['II','MM'].includes(order)) throw issue('INVALID_METADATA', '손상된 EXIF 방향 정보입니다.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(2, little) !== 42) throw issue('INVALID_METADATA', '손상된 EXIF 방향 정보입니다.');
    const offset = view.getUint32(4, little);
    if (offset > bytes.length - 2) throw issue('INVALID_METADATA', '손상된 EXIF 방향 정보입니다.');
    const count = view.getUint16(offset, little);
    if (count > 512 || offset + 2 + count * 12 + 4 > bytes.length) throw issue('INVALID_METADATA', '손상된 EXIF 방향 정보입니다.');
    let seen = false;
    for (let i = 0; i < count; i++) {
      const start = offset + 2 + i * 12;
      if (view.getUint16(start, little) !== 0x112) continue;
      const value = view.getUint16(start + 8, little);
      if (seen || view.getUint16(start + 2, little) !== 3 || view.getUint32(start + 4, little) !== 1 || value < 1 || value > 8) throw issue('INVALID_METADATA', '유효하지 않거나 중복된 EXIF 방향 정보입니다.');
      values.push(value); seen = true;
    }
  }
  if (new Set(values).size > 1 || (values.length && Number(parsed.metadata.orientation) !== values[0])) throw issue('INVALID_METADATA', 'EXIF 방향 정보가 서로 다릅니다.');
  return Number(parsed.metadata.orientation || 1);
}

function pending(promise, signal, { late = () => {}, timeoutMs = PHOTO_ASSET_LIMITS.timeoutMs } = {}) {
  const discard = value => { try { late(value); } catch { /* Cleanup never publishes a partial result. */ } };
  if (signal?.aborted) {
    Promise.resolve(promise).then(discard, () => {});
    return Promise.reject(issue('ABORTED', '이미지 처리를 취소했습니다.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const finish = (error, value) => { if (settled) { if (!error) discard(value); return; } settled = true; clean(); error ? reject(error) : resolve(value); };
    const abort = () => finish(issue('ABORTED', '이미지 처리를 취소했습니다.'));
    const timer = setTimeout(() => finish(issue('PROCESSING_TIMEOUT', '이미지 처리 시간이 초과됐습니다.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
  });
}
async function hash(blob, signal, wait = pending, sourceBytes = null) {
  const bytes = sourceBytes || await wait(blob.arrayBuffer(), signal); abortCheck(signal);
  const digest = await wait(crypto.subtle.digest('SHA-256', bytes), signal); abortCheck(signal);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const matrices = (w, h) => [null, [1,0,0,1,0,0], [-1,0,0,1,w,0], [-1,0,0,-1,w,h], [1,0,0,-1,0,h], [0,1,1,0,0,0], [0,1,-1,0,h,0], [0,-1,-1,0,h,w], [0,-1,1,0,0,w]];

// Shared with the browser upload-copy adapter; these retain the same limits and
// strict container/EXIF checks used for local display assets.
export { format as inspectPhotoFormat, png as inspectPhotoPng, jpeg as inspectPhotoJpeg,
  webp as inspectPhotoWebp, checkedOrientation as checkedPhotoOrientation,
  matrices as photoOrientationMatrices, pending as awaitPhotoProcessing };

export async function processPhotoAssets(options = {}) {
  let bitmap = null, slot = null; const canvases = [];
  const wait=(promise,signal,options)=>pending(slot.track(promise),signal,options);
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw issue('INVALID_OPTIONS', '이미지 처리 옵션 객체가 필요합니다.');
    if (Object.keys(options).some(key => !['file', 'signal', 'displayMaxEdge', 'thumbnailMaxEdge'].includes(key))) throw issue('INVALID_OPTIONS', '지원하지 않는 이미지 처리 옵션입니다.');
    const { file, signal, displayMaxEdge = 1600, thumbnailMaxEdge = 320 } = options;
    if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size < 1) throw issue('INVALID_INPUT', '이미지 Blob 또는 File이 필요합니다.');
    if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) throw issue('INVALID_INPUT', 'AbortSignal을 확인하세요.');
    abortCheck(signal);
    if (file.size > PHOTO_ASSET_LIMITS.sourceMaxBytes) throw issue('EXCESSIVE_INPUT', '브라우저 입력은 64MiB까지 지원합니다. 원본을 유지하고 기존 로컬 변환 도구로 FHD 사본을 만든 뒤 선택해 주세요.');
    if (!finiteSize(displayMaxEdge) || !finiteSize(thumbnailMaxEdge) || thumbnailMaxEdge > displayMaxEdge || displayMaxEdge > 4096) throw issue('INVALID_OPTIONS', '표시본·썸네일 크기 범위를 확인하세요.');
    if (typeof createImageBitmap !== 'function' || !globalThis.crypto?.subtle || typeof globalThis.document?.createElement !== 'function') throw issue('ENVIRONMENT_UNAVAILABLE', '이미지 처리와 SHA256을 지원하는 브라우저가 필요합니다.');
    slot=claimPhotoProcessing();if(!slot)throw issue('PROCESSING_BUSY','다른 사진 처리가 끝난 뒤 다시 시도해 주세요.');
    const input = new Uint8Array(await wait(Blob.prototype.arrayBuffer.call(file), signal)); abortCheck(signal);
    if (input.byteLength !== file.size) corrupt();
    const mediaType = format(input);
    if (file.type && file.type.toLowerCase() !== mediaType) throw issue('FORMAT_MISMATCH', '파일 형식 표기와 실제 이미지 바이트가 다릅니다.');
    const header = mediaType === 'image/png' ? png(input) : mediaType === 'image/jpeg' ? jpeg(input) : webp(input);
    const parsed = parsePhotoMetadata(input);
    if (parsed.status === 'invalid') throw issue('INVALID_METADATA', '손상된 촬영정보 또는 방향 정보를 처리할 수 없습니다.');
    const orientation = checkedOrientation(header.exif, parsed);
    const sha256 = await hash(file, signal, wait, input);
    const decodeScale=Math.min(1,displayMaxEdge/Math.max(header.width,header.height));
    const decodeWidth=Math.max(1,Math.round(header.width*decodeScale)),decodeHeight=Math.max(1,Math.round(header.height*decodeScale));
    bitmap = await wait(createImageBitmap(new Blob(photoDecodeParts(input,mediaType,header), { type: mediaType }), { imageOrientation: 'none', colorSpaceConversion:'default', resizeWidth:decodeWidth, resizeHeight:decodeHeight, resizeQuality:'high' }), signal, { late: value => value?.close() });
    abortCheck(signal);
    if (bitmap.width !== decodeWidth || bitmap.height !== decodeHeight) throw issue('DIMENSION_MISMATCH', '디코딩 결과와 이미지 치수가 다릅니다.');
    const orientedWidth = orientation >= 5 ? header.height : header.width, orientedHeight = orientation >= 5 ? header.width : header.height;
    async function derivative(role, maxEdge) {
      abortCheck(signal);
      const scale = Math.min(1, maxEdge / Math.max(orientedWidth, orientedHeight));
      const pixelWidth = Math.max(1, Math.round(orientedWidth * scale)), pixelHeight = Math.max(1, Math.round(orientedHeight * scale));
      const canvas = document.createElement('canvas'); canvases.push(canvas); canvas.width = pixelWidth; canvas.height = pixelHeight;
      const ctx = canvas.getContext('2d',{colorSpace:'srgb'}); if (!ctx) throw issue('CANVAS_UNAVAILABLE', '이미지 변환 화면을 만들 수 없습니다.');
      ctx.scale(pixelWidth / orientedWidth, pixelHeight / orientedHeight);
      ctx.transform(...matrices(header.width, header.height)[orientation]); ctx.drawImage(bitmap, 0, 0, header.width, header.height);
      const blob = await wait(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), signal);
      if (!blob || blob.type !== 'image/png') throw issue('ENCODING_FAILED', '파생본을 생성할 수 없습니다.');
      if(blob.size>PHOTO_ASSET_LIMITS.maxBytes)throw issue('EXCESSIVE_OUTPUT','표시본 용량이 25MiB를 초과했습니다.');
      const output = new Uint8Array(await wait(blob.arrayBuffer(), signal)), outputHeader = png(output);
      if (outputHeader.width !== pixelWidth || outputHeader.height !== pixelHeight) throw issue('DIMENSION_MISMATCH', '파생본 치수가 변환 결과와 다릅니다.');
      if (outputHeader.hasMetadata || parsePhotoMetadata(output).status !== 'absent') throw issue('METADATA_NOT_STRIPPED', '파생본 촬영정보 제거를 확인하지 못했습니다.');
      abortCheck(signal);
      return { role, blob, sha256: await hash(blob, signal, wait, output), mediaType: 'image/png', byteSize: blob.size, pixelWidth, pixelHeight, orientation: 1, exifPolicy: 'stripped',
        transformSpec: { version: PHOTO_ASSET_PROCESSING_VERSION, parentSha256: sha256, sourceOrientation: orientation, sourceOrientationSource: parsed.metadata.orientation ? 'exif' : 'default', fit: 'contain', cropped: false, upscaled: false, maxEdge, orientedWidth, orientedHeight, scaleX: pixelWidth / orientedWidth, scaleY: pixelHeight / orientedHeight } };
    }
    const display = await derivative('display', displayMaxEdge), thumbnail = await derivative('thumbnail', thumbnailMaxEdge);
    abortCheck(signal);
    return { ok: true, metadataRead:parsed, original: { role: 'original', blob: file, sha256, mediaType, byteSize: file.size, pixelWidth: header.width, pixelHeight: header.height, orientation: parsed.metadata.orientation ? orientation : null, exifPolicy: 'preserved' }, display, thumbnail, issues: [] };
  } catch (error) {
    return { ok: false, issues: [{ code: error instanceof ProcessingError ? error.code : 'PROCESSING_FAILED', message: error instanceof ProcessingError ? error.message : '이미지를 처리하지 못했습니다. 원본은 변경하지 않았습니다.' }] };
  } finally {
    bitmap?.close();
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    slot?.release();
  }
}
