import { context, draw } from './image.mjs';

function otsu(histogram, count) {
  const total = histogram.reduce((sum, frequency, i) => sum + i * frequency, 0);
  let best = -1, threshold = 127, weight = 0, sum = 0;
  for (let i = 0; i < 255; i++) {
    weight += histogram[i];
    sum += histogram[i] * i;
    if (!weight || weight === count) continue;
    const variance = weight * (count - weight) * (sum / weight - (total - sum) / (count - weight)) ** 2;
    if (variance > best) {
      best = variance;
      threshold = i;
    }
  }
  return threshold;
}

export function detectRounds(original, strictness) {
  const scale = Math.min(1, 650 / Math.max(original.width, original.height));
  const image = scale === 1 ? original : draw(original, original.width * scale, original.height * scale);
  const { width, height } = image;
  const size = width * height;
  const pixels = context(image, true).getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(size);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    gray[i] = (pixels[p] * .2126 + pixels[p + 1] * .7152 + pixels[p + 2] * .0722) * pixels[p + 3] / 255 + (255 - pixels[p + 3]);
    histogram[gray[i]]++;
  }
  const threshold = otsu(histogram, size);
  const border = [...gray.subarray(0, width), ...gray.subarray(size - width)];
  for (let y = 1; y < height - 1; y++) border.push(gray[y * width], gray[y * width + width - 1]);
  const lightBackground = border.filter(value => value > threshold).length > border.length / 2;
  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) mask[i] = Number(lightBackground ? gray[i] <= threshold : gray[i] > threshold);
  const queue = new Int32Array(size);
  const hits = [];
  for (let seed = 0; seed < size; seed++) {
    if (mask[seed] !== 1) continue;
    queue[0] = seed;
    mask[seed] = 2;
    let head = 0, tail = 1, edge = 0;
    let xMin = width, xMax = 0, yMin = height, yMax = 0, sumX = 0, sumY = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      sumX += x; sumY += y;
      for (const next of [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (next === -1 || mask[next] === 0) edge++;
        else if (mask[next] === 1) {
          mask[next] = 2;
          queue[tail++] = next;
        }
      }
    }
    const w = xMax - xMin + 1, h = yMax - yMin + 1;
    const circular = 4 * Math.PI * tail / (edge * edge);
    const fill = tail / (w * h);
    if (tail < Math.max(22, size * .00010) || tail > size * .62 || Math.min(w, h) / Math.max(w, h) < .35 + strictness * .3 ||
        circular < .20 + strictness * .37 || fill < .35 || xMin === 0 || yMin === 0 || xMax === width - 1 || yMax === height - 1) continue;
    hits.push({ x: sumX / tail / scale, y: sumY / tail / scale, box: [xMin / scale, yMin / scale, w / scale, h / scale], label: '圆形截面' });
  }
  return hits.sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 300);
}
