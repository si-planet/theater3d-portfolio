// Authored geometry only. No photograph, EXIF, remote image or venue data.
// The 35 mm value is a demonstration input, not a measurement of this drawing.
export const SAMPLE_PHOTO = Object.freeze({
  filename: '가상 무대 · 투영 예제.png', width: 1620, height: 1080,
  focalLength35Mm: '35', seatLabel: '가상 SYN-R2-N3',
});

export async function createPortfolioSamplePhoto(documentRef = document) {
  const canvas = documentRef.createElement('canvas');
  canvas.width = SAMPLE_PHOTO.width; canvas.height = SAMPLE_PHOTO.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('SYNTHETIC_CANVAS_UNAVAILABLE');
  const background = ctx.createLinearGradient(0, 0, 0, 1080);
  background.addColorStop(0, '#111827'); background.addColorStop(1, '#030712');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1620, 1080);
  ctx.fillStyle = '#193646'; ctx.fillRect(180, 170, 1260, 590);
  ctx.fillStyle = '#285260'; ctx.fillRect(210, 200, 1200, 520);
  ctx.strokeStyle = '#79a3ad'; ctx.lineWidth = 3;
  for (let x = 210; x <= 1410; x += 120) {
    ctx.beginPath(); ctx.moveTo(x, 200); ctx.lineTo(x, 720); ctx.stroke();
  }
  ctx.fillStyle = '#704f45'; ctx.beginPath();
  ctx.moveTo(210, 720); ctx.lineTo(1410, 720);
  ctx.lineTo(1510, 930); ctx.lineTo(110, 930); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#46332f'; ctx.fillRect(110, 930, 1400, 45);
  for (const [x, color] of [[620, '#91b8e0'], [1000, '#e5a7bc']]) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, 435, 45, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 48, 490, 96, 175);
    ctx.fillRect(x - 43, 660, 31, 150); ctx.fillRect(x + 12, 660, 31, 150);
  }
  ctx.fillStyle = '#e3c095'; ctx.fillRect(280, 620, 180, 190);
  ctx.fillStyle = '#78978e'; ctx.fillRect(1170, 510, 170, 300);
  ctx.fillStyle = '#c7d8e3'; ctx.textAlign = 'center'; ctx.font = '500 28px system-ui';
  ctx.fillText('SYNTHETIC STAGE · 6:4', 810, 92);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    result => result ? resolve(result) : reject(new Error('SYNTHETIC_IMAGE_UNAVAILABLE')), 'image/png'));
  return new File([blob], SAMPLE_PHOTO.filename, {type: 'image/png', lastModified: 0});
}

export async function seedPortfolioSamplePhoto(manager, context) {
  if (!context || context.seatLabel !== SAMPLE_PHOTO.seatLabel) return false;
  await manager.whenLocalReady();
  const alreadyStored = manager.getSnapshot().items.some(item =>
    item.name === SAMPLE_PHOTO.filename && item.seatContext?.seatId === context.seatId);
  if (alreadyStored) return false;
  const file = await createPortfolioSamplePhoto();
  const snapshot = manager.addFiles([file], {seatContext: context});
  const photo = snapshot.items.find(item => item.name === SAMPLE_PHOTO.filename);
  if (!photo) return false;
  manager.select(photo.id);
  manager.updateSelected({focalLength35Mm: SAMPLE_PHOTO.focalLength35Mm,
    production: '가상 무대 예제', device: '브라우저 생성 도형 · 실제 촬영 아님'});
  await manager.flushProcessing();
  return true;
}
