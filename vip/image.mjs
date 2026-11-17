const MAX_PIXELS = 16_000_000;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const allowed = /\.(?:jpe?g|png|webp|bmp|gif|avif)$/i;

export function imageFile(file) {
  return (file.type.startsWith('image/') && file.type !== 'image/svg+xml') || (!file.type && allowed.test(file.name));
}

export function canvas(width, height) {
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.round(width));
  result.height = Math.max(1, Math.round(height));
  return result;
}

export function context(image, pixels = false) {
  return image.getContext('2d', { willReadFrequently: pixels });
}

export function draw(source, width = source.width, height = source.height) {
  const output = canvas(width, height);
  const painter = context(output);
  painter.imageSmoothingQuality = 'high';
  painter.drawImage(source, 0, 0, output.width, output.height);
  return output;
}

export async function readImage(file, maxSide = 3500) {
  if (!imageFile(file)) throw new Error('请选择 JPG、PNG、WebP 等位图。');
  if (file.size > MAX_FILE_BYTES) throw new Error('单张图片不能超过 24 MB。');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (Math.min(width, height) < 12) throw new Error('图片短边需至少 12 像素。');
    if (width * height > 100_000_000) throw new Error('图片超过 1 亿像素，请先缩小。');
    const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
    return draw(image, width * scale, height * scale);
  } catch (failure) {
    if (failure instanceof DOMException) throw new Error('无法读取此图片。请改用 JPG、PNG 或 WebP。');
    throw failure;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function yieldFrame() {
  return new Promise(resolve => setTimeout(resolve, 25));
}

export function exportImage(image, type = 'image/png', quality = 0.96) {
  return new Promise((resolve, reject) => {
    image.toBlob(result => result ? resolve(result) : reject(new Error('图片导出失败。')), type, quality);
  });
}

export async function printJpeg(image) {
  const bytes = new Uint8Array(await (await exportImage(image, 'image/jpeg', 0.98)).arrayBuffer());
  const jfif = new Uint8Array([0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0]);
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 10)) === 'JFIF') {
    const length = bytes[4] * 256 + bytes[5];
    return new Blob([bytes.subarray(0, 2), jfif, bytes.subarray(4 + length)], { type: 'image/jpeg' });
  }
  return new Blob([bytes.subarray(0, 2), jfif, bytes.subarray(2)], { type: 'image/jpeg' });
}

export function printSheet(photo) {
  const output = canvas(1800, 1200);
  const painter = context(output);
  painter.fillStyle = 'white';
  painter.fillRect(0, 0, output.width, output.height);
  const margin = 35;
  const gap = 22;
  const arrange = (width, height) => {
    const columns = Math.floor((output.width - 2 * margin + gap) / (width + gap));
    const rows = Math.floor((output.height - 2 * margin + gap) / (height + gap));
    return { width, height, columns, rows };
  };
  const normal = arrange(photo.width, photo.height);
  const rotated = arrange(photo.height, photo.width);
  const rotate = rotated.columns * rotated.rows > normal.columns * normal.rows;
  const { width, height, columns, rows } = rotate ? rotated : normal;
  if (columns * rows < 1) throw new Error('此规格放不进 6 寸相纸。');
  const left = (output.width - (columns * (width + gap) - gap)) / 2;
  const top = (output.height - (rows * (height + gap) - gap)) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      painter.save();
      painter.translate(left + col * (width + gap), top + row * (height + gap));
      if (rotate) {
        painter.translate(width, 0);
        painter.rotate(Math.PI / 2);
      }
      painter.drawImage(photo, 0, 0);
      painter.strokeStyle = '#ddd';
      painter.strokeRect(0, 0, photo.width, photo.height);
      painter.restore();
    }
  }
  return output;
}

export function nameStem(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 96) || '图片';
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
