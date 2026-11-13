// Read only the small allowlist used for photo comparison. GPS, serial numbers,
// MakerNote and embedded thumbnails are deliberately never traversed or returned.
export const EXIF_REFERENCE_URL = 'https://www.cipa.jp/std/documents/download_e.html?CIPA_DC-008-2024-E';
const MAX_IFD_ENTRIES = 512;
const MAX_IFDS = 8;
const MAX_CHUNKS = 4096;

function text(value, limit = 200) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}

/** Filename labels are hints, not an automatic link to an official seat ID. */
export function parsePhotoLabel(name = '', relativePath = '') {
  const basename = text(typeof name === 'string' ? name.split(/[\\/]/).pop() ?? '' : '', 255).replace(/\.[^.]+$/, '');
  // Duplicate-name suffixes distinguish files; they do not identify the seat,
  // capture order or zoom. Keep the original filename on the photo itself.
  const labeledName = basename.replace(/(?:\s*\(\d{1,5}\)|_\d{1,5})$/, '');
  const separator = labeledName.lastIndexOf('_');
  const production = separator > 0 ? text(labeledName.slice(0, separator), 200) : '';
  const rawCandidate = separator > 0 ? labeledName.slice(separator + 1) : '';
  const candidate = text(rawCandidate, 100).replace(/\s+/g, ' ');
  // Normalize only while validating, so decomposed Korean from macOS matches
  // the same grammar without rewriting the supplied production/seat labels.
  const seatPattern = /^(?:\d{1,3}층-)?(?:[a-z\d가-힣]{1,20}구역-)?(?:[a-z]{1,3}\d{1,3}|\d{1,3}열 *\d{1,3}번)$/i;
  const valid = production && rawCandidate.length <= 100 && seatPattern.test(candidate.normalize('NFC'));
  const seatLabel = valid ? candidate.replace(/[a-z]{1,3}(?=\d{1,3}$)/i, letters => letters.toUpperCase()) : '';
  const parts = typeof relativePath === 'string' ? relativePath.split(/[\\/]/).filter(Boolean) : [];
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  return {
    venueName: parent && !['.', '..'].includes(parent) ? text(parent, 200) : '',
    production: valid ? production : '',
    seatLabel,
  };
}

function bytesFrom(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Image bytes are required');
}

function asciiAt(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + Math.min(length, 512)));
}

function isExifPrefix(bytes, offset = 0) { return asciiAt(bytes, offset, 6) === 'Exif\0\0'; }

function parseTiff(bytes) {
  if (bytes.length < 8) throw new RangeError('Short TIFF header');
  const order = asciiAt(bytes, 0, 2);
  if (order !== 'II' && order !== 'MM') throw new TypeError('Invalid TIFF byte order');
  const little = order === 'II';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function bounded(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length - length) throw new RangeError('EXIF offset outside metadata');
  }
  function short(offset) { bounded(offset, 2); return view.getUint16(offset, little); }
  function long(offset) { bounded(offset, 4); return view.getUint32(offset, little); }
  if (short(2) !== 42) throw new TypeError('Invalid TIFF signature');
  const values = {};
  const visited = new Set();
  const allowed = new Set([0x0100, 0x0101, 0x010f, 0x0110, 0x0112, 0x9003, 0x9011, 0x9291, 0x920a, 0xa002, 0xa003, 0xa404, 0xa405, 0xa434]);
  function read(entry) {
    const type = short(entry + 2);
    const count = long(entry + 4);
    const sizes = { 2: 1, 3: 2, 4: 4, 5: 8 };
    const size = sizes[type];
    if (!size || !count || count > (type === 2 ? 512 : 1)) return undefined;
    const length = size * count;
    const offset = length <= 4 ? entry + 8 : long(entry + 8);
    bounded(offset, length);
    if (type === 2) return text(asciiAt(bytes, offset, count).split('\0')[0], 256);
    if (type === 3) return short(offset);
    if (type === 4) return long(offset);
    const denominator = long(offset + 4);
    return denominator ? long(offset) / denominator : undefined;
  }
  function visit(offset) {
    if (!offset) return;
    if (visited.has(offset) || visited.size >= MAX_IFDS) throw new RangeError('Cyclic or excessive EXIF IFDs');
    visited.add(offset);
    bounded(offset, 2);
    const count = short(offset);
    if (count > MAX_IFD_ENTRIES) throw new RangeError('Excessive EXIF entries');
    bounded(offset + 2, count * 12 + 4);
    let exifPointer;
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = short(entry);
      if (tag === 0x8769) {
        if (short(entry + 2) === 4 && long(entry + 4) === 1) exifPointer = read(entry);
      } else if (allowed.has(tag)) {
        const value = read(entry);
        if (value !== undefined && values[tag] === undefined) values[tag] = value;
      }
    }
    // Only the Exif IFD is needed. The next IFD, GPS and MakerNote pointers may
    // contain private fields or thumbnail dimensions and are not followed.
    if (exifPointer) visit(exifPointer);
  }
  const first = long(4);
  if (first < 8) throw new RangeError('Invalid root IFD');
  visit(first);
  return values;
}

function locateMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let tiff = null;
  let width = null;
  let height = null;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    for (let count = 0; offset < bytes.length && count < MAX_CHUNKS; count++) {
      if (bytes[offset++] !== 0xff) throw new TypeError('Invalid JPEG marker');
      while (bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) throw new RangeError('Truncated JPEG marker');
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) throw new RangeError('Truncated JPEG segment');
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw new RangeError('Invalid JPEG segment length');
      const start = offset + 2;
      if (marker === 0xe1 && isExifPrefix(bytes, start) && !tiff) tiff = bytes.subarray(start + 6, offset + size);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
        height = view.getUint16(start + 1); width = view.getUint16(start + 3);
      }
      offset += size;
    }
  } else if (bytes.length >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, 7) === 'PNG\r\n\x1a\n') {
    let offset = 8;
    for (let count = 0; offset < bytes.length && count < MAX_CHUNKS; count++) {
      if (offset + 12 > bytes.length) throw new RangeError('Truncated PNG chunk');
      const size = view.getUint32(offset);
      if (size > bytes.length - offset - 12) throw new RangeError('Invalid PNG chunk length');
      const kind = asciiAt(bytes, offset + 4, 4);
      const start = offset + 8;
      if (kind === 'IHDR' && size === 13) { width = view.getUint32(start); height = view.getUint32(start + 4); }
      if (kind === 'eXIf' && !tiff) tiff = bytes.subarray(start, start + size);
      offset += size + 12;
      if (kind === 'IEND') break;
    }
  } else if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 12) throw new RangeError('Invalid WebP RIFF length');
    let offset = 12;
    for (let count = 0; offset < end && count < MAX_CHUNKS; count++) {
      if (offset + 8 > end) throw new RangeError('Truncated WebP chunk');
      const kind = asciiAt(bytes, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (size > end - start) throw new RangeError('Invalid WebP chunk length');
      if (kind === 'EXIF' && !tiff) tiff = bytes.subarray(start + (isExifPrefix(bytes, start) ? 6 : 0), start + size);
      if (kind === 'VP8X' && size >= 10) {
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      }
      offset = start + size + (size % 2);
    }
  } else if (bytes.length >= 8 && ['II', 'MM'].includes(asciiAt(bytes, 0, 2))) {
    tiff = bytes;
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(asciiAt(bytes, 0, 6))) {
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  }
  return { tiff, width, height };
}

function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null; }
function numericText(value) { return String(Math.round(value * 1e6) / 1e6); }

/** Parse an allowlist without changing any pixels or inferring missing optics. */
export function parsePhotoMetadata(input, { name = '', relativePath = '' } = {}) {
  const metadata = {};
  const sources = {};
  const notes = [];
  for (const [key, value] of Object.entries(parsePhotoLabel(name, relativePath))) {
    if (value) { metadata[key] = value; sources[key] = 'filename'; }
  }
  let status = 'absent';
  try {
    const located = locateMetadata(bytesFrom(input));
    const tags = located.tiff ? parseTiff(located.tiff) : {};
    status = located.tiff ? 'parsed' : 'absent';
    const put = (key, value) => { if (value !== '' && value != null) { metadata[key] = String(value); sources[key] = 'exif'; } };
    const make = typeof tags[0x010f] === 'string' ? tags[0x010f] : '';
    const model = typeof tags[0x0110] === 'string' ? tags[0x0110] : '';
    put('device', model && make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model || make);
    put('lens', typeof tags[0xa434] === 'string' ? tags[0xa434] : '');
    const focal = positive(tags[0x920a]);
    const focal35 = positive(tags[0xa405]);
    const digitalZoom = positive(tags[0xa404]);
    if (focal) put('focalLengthMm', numericText(focal));
    if (focal35) put('focalLength35Mm', numericText(focal35));
    if (digitalZoom) put('digitalZoomRatio', numericText(digitalZoom));
    const date = tags[0x9003];
    if (typeof date === 'string' && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      const subseconds = typeof tags[0x9291] === 'string' && /^\d{1,9}$/.test(tags[0x9291]) ? `.${tags[0x9291]}` : '';
      const zone = typeof tags[0x9011] === 'string' && /^[+-]\d{2}:\d{2}$/.test(tags[0x9011]) ? ` ${tags[0x9011]}` : '';
      put('captureDateTime', `${date.slice(0, 10).replace(/:/g, '-')} ${date.slice(11)}${subseconds}${zone}`);
    }
    const width = positive(located.width) || positive(tags[0xa002]) || positive(tags[0x0100]);
    const height = positive(located.height) || positive(tags[0xa003]) || positive(tags[0x0101]);
    const orientation = Number.isInteger(tags[0x0112]) && tags[0x0112] >= 1 && tags[0x0112] <= 8 ? tags[0x0112] : null;
    if (width) { put('pixelWidth', width); if (positive(located.width)) sources.pixelWidth = 'file'; }
    if (height) { put('pixelHeight', height); if (positive(located.height)) sources.pixelHeight = 'file'; }
    if (orientation) put('orientation', orientation);
    if (width && height) {
      const rotated = orientation >= 5 && orientation <= 8;
      put('aspectRatio', numericText(rotated ? height / width : width / height));
      if (!orientation && sources.pixelWidth === 'file' && sources.pixelHeight === 'file') sources.aspectRatio = 'file';
    }
    if (!focal35 && focal) notes.push('실제 초점거리만 기록돼 있어 35mm 환산값은 비워 둡니다. 센서 정보 없이 환산하거나 줌 배율을 곱하지 않습니다.');
    if (digitalZoom) notes.push('EXIF 디지털 줌은 휴대폰 화면의 전체 줌 배율과 다를 수 있습니다.');
    if (!located.tiff) notes.push('읽을 수 있는 EXIF가 없습니다. 원본 미리보기와 파일명 라벨은 유지합니다.');
  } catch {
    status = 'invalid';
    notes.push('사진 정보의 형식이나 범위가 올바르지 않아 자동 추출을 건너뛰었습니다. 원본은 변경하지 않습니다.');
  }
  return { metadata, sources, status, notes };
}

export async function readPhotoMetadata(file) {
  const options = { name: typeof file?.name === 'string' ? file.name : '', relativePath: typeof file?.webkitRelativePath === 'string' ? file.webkitRelativePath : '' };
  try {
    return parsePhotoMetadata(await file.arrayBuffer(), options);
  } catch {
    const label = parsePhotoLabel(options.name, options.relativePath);
    const metadata = Object.fromEntries(Object.entries(label).filter(([, value]) => value));
    return { metadata, sources: Object.fromEntries(Object.keys(metadata).map(key => [key, 'filename'])), status: 'read_failed', notes: ['사진 정보를 읽을 수 없습니다. 원본 미리보기와 파일명 라벨은 유지합니다.'] };
  }
}
