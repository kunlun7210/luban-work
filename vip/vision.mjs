import { canvas, clamp, context, draw, yieldFrame } from './image.mjs';

const base = new URL('./vendor/vision/', import.meta.url).href;
const modelRoot = 'https://storage.googleapis.com/mediapipe-models/';
const modelPaths = {
  "face.task": "face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "person.tflite": "image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
  "objects.tflite": "object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite"
};
let library;
const engines = new Map();

async function loadVision() {
  library ??= import('./vendor/vision/vision_bundle.mjs').then(async api => ({
    api, platform: await api.FilesetResolver.forVisionTasks(base + 'wasm'),
  })).catch(error => { library = undefined; throw error; });
  return library;
}

async function engine(name) {
  if (!engines.has(name)) {
    const task = loadVision().then(({ api, platform }) => {
      const settings = { runningMode: 'IMAGE', baseOptions: { delegate: 'CPU', modelAssetPath: modelRoot + modelPaths[name] } };
      if (name === 'person.tflite') {
        return api.ImageSegmenter.createFromOptions(platform, { ...settings, outputConfidenceMasks: true, outputCategoryMask: false });
      }
      if (name === 'face.task') {
        return api.FaceLandmarker.createFromOptions(platform, { ...settings, numFaces: 3, minFaceDetectionConfidence: .55, minFacePresenceConfidence: .55 });
      }
      return api.ObjectDetector.createFromOptions(platform, { ...settings, maxResults: 100, scoreThreshold: .1 });
    }).catch(error => { engines.delete(name); throw error; });
    engines.set(name, task);
  }
  return engines.get(name);
}

async function singleFace(image, label) {
  const landmarker = await engine('face.task');
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const input = scale < 1 ? draw(image, image.width * scale, image.height * scale) : image;
  const landmarks = landmarker.detect(input).faceLandmarks;
  if (input !== image) input.width = input.height = 1;
  if (landmarks.length !== 1) throw new Error(landmarks.length ? label + '检测到多人。请裁成单人照片。' : label + '没有检测到清晰人脸。请换一张正面、光线充足的照片。');
  return landmarks[0].map(point => [point.x * image.width, point.y * image.height]);
}

export async function cutout(image, sensitivity = 50) {
  const segmenter = await engine('person.tflite');
  const mask = segmenter.segment(image);
  const foreground = mask.confidenceMasks?.[1] ?? mask.confidenceMasks?.[0];
  if (!foreground) {
    mask.close?.();
    throw new Error('无法生成前景遮罩。');
  }
  try {
    const maskPixels = canvas(foreground.width, foreground.height);
    const maskContext = context(maskPixels, true);
    const pixels = maskContext.createImageData(foreground.width, foreground.height);
    const scores = foreground.getAsFloat32Array();
    const cutoff = .46 - (sensitivity - 50) / 180;
    let area = 0;
    for (let i = 0; i < scores.length; i++) {
      const alpha = clamp((scores[i] - cutoff + .19) / .42, 0, 1);
      pixels.data[i * 4 + 3] = Math.round(255 * alpha * alpha * (3 - 2 * alpha));
      area += alpha;
    }
    if (area < scores.length * .012) throw new Error('没找到足够大的人像，请换一张主体更清楚的图片。');
    maskContext.putImageData(pixels, 0, 0);
    const output = draw(image);
    const painter = context(output);
    painter.globalCompositeOperation = 'destination-in';
    painter.drawImage(maskPixels, 0, 0, output.width, output.height);
    painter.globalCompositeOperation = 'source-over';
    return output;
  } finally {
    mask.close();
  }
}

export async function makeIdPhoto(image, options, progress) {
  progress('定位人脸…');
  const points = await singleFace(image, '证件照');
  await yieldFrame();
  progress('分离人像与背景…');
  const transparent = await cutout(image, options.sensitivity);
  const [left, right] = [points[234], points[454]];
  const faceHeight = points[152][1] - points[10][1];
  if (Math.abs(left[1] - right[1]) > faceHeight * .25 || faceHeight < 20) {
    throw new Error('人脸倾斜过大或过小，请使用居中的正面照。');
  }
  const { width, height, zoom, shiftX, shiftY, background } = options;
  const scale = height * .49 / faceHeight * zoom / 100;
  const center = (left[0] + right[0]) / 2;
  const offsetX = width * (.5 + shiftX / 100) - center * scale;
  const offsetY = height * (.30 + shiftY / 100) - points[10][1] * scale;
  if (offsetY + transparent.height * scale < height * .94) {
    throw new Error('原图的肩部裁切太紧。请向下移动人像或换用保留肩部的照片。');
  }
  const output = canvas(width, height);
  const painter = context(output);
  painter.fillStyle = background;
  painter.fillRect(0, 0, width, height);
  painter.imageSmoothingQuality = 'high';
  painter.drawImage(transparent, offsetX, offsetY, transparent.width * scale, transparent.height * scale);
  return output;
}

const oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const features = [6, 168, 1, 2, 4, 98, 327, 9, 151, 33, 133, 159, 145, 160, 144, 263, 362, 386, 374, 385, 380, 70, 105, 107, 336, 334, 300, 61, 291, 0, 17, 13, 14, 37, 267, 84, 314, 200, 111, 340, 117, 346, 206, 426];

function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function affine(a, b, c, p, q, r) {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1];
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < .01) return null;
  const Ux = q[0] - p[0], Uy = q[1] - p[1], Vx = r[0] - p[0], Vy = r[1] - p[1];
  const x = (Ux * vy - Vx * uy) / det, y = (Uy * vy - Vy * uy) / det;
  const xx = (Vx * ux - Ux * vx) / det, yy = (Vy * ux - Uy * vx) / det;
  return [x, y, xx, yy, p[0] - x * a[0] - xx * a[1], p[1] - y * a[0] - yy * a[1]];
}

export async function fuseFaces(base, donor, strength, progress) {
  progress('定位两张照片的人脸…');
  const target = await singleFace(base, '模板图');
  const source = await singleFace(donor, '前景图');
  const { default: Delaunator } = await import('./vendor/delaunator.mjs');
  await yieldFrame();
  progress('对齐五官并融合肤色…');
  const indices = [...oval, ...features];
  const triangles = Delaunator.from(indices.map(index => target[index])).triangles;
  const layers = canvas(base.width, base.height);
  const painter = context(layers, true);
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]].map(index => indices[index]);
    const transform = affine(source[a], source[b], source[c], target[a], target[b], target[c]);
    if (!transform) continue;
    const points = [target[a], target[b], target[c]];
    const center = [0, 1].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / 3);
    painter.save();
    painter.beginPath();
    for (const point of points) {
      const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
      const grow = 1 + .8 / Math.max(1, distance);
      painter.lineTo(center[0] + (point[0] - center[0]) * grow, center[1] + (point[1] - center[1]) * grow);
    }
    painter.closePath();
    painter.clip();
    painter.setTransform(...transform);
    painter.drawImage(donor, 0, 0);
    painter.restore();
  }
  const edge = oval.map(index => target[index]);
  const x = Math.max(0, Math.floor(Math.min(...edge.map(p => p[0]))));
  const y = Math.max(0, Math.floor(Math.min(...edge.map(p => p[1]))));
  const width = Math.min(base.width, Math.ceil(Math.max(...edge.map(p => p[0])))) - x;
  const height = Math.min(base.height, Math.ceil(Math.max(...edge.map(p => p[1])))) - y;
  if (Math.min(width, height) < 30) throw new Error('模板图的人脸尺寸过小。');
  const output = draw(base);
  const out = context(output, true);
  const part = painter.getImageData(x, y, width, height);
  const pixels = out.getImageData(x, y, width, height);
  const deltas = [0, 0, 0];
  let sampleCount = 0;
  for (let dy = Math.floor(height * .28); dy < height * .7; dy += 4) {
    for (let dx = Math.floor(width * .23); dx < width * .77; dx += 4) {
      const at = (dy * width + dx) * 4;
      if (part.data[at + 3] < 220) continue;
      for (let channel = 0; channel < 3; channel++) deltas[channel] += pixels.data[at + channel] - part.data[at + channel];
      sampleCount++;
    }
  }
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const at = (dy * width + dx) * 4;
      if (!part.data[at + 3]) continue;
      let distance = Infinity, inside = false;
      for (let i = 0, j = edge.length - 1; i < edge.length; j = i++) {
        const a = edge[i], b = edge[j], px = x + dx, py = y + dy;
        if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        distance = Math.min(distance, segmentDistance(px, py, a, b));
      }
      if (!inside) continue;
      const weight = clamp(distance / (width * .13), 0, 1) * strength / 100 * part.data[at + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        const color = clamp(part.data[at + channel] + clamp(deltas[channel] / Math.max(1, sampleCount), -60, 60) * .72, 0, 255);
        pixels.data[at + channel] += (color - pixels.data[at + channel]) * weight;
      }
    }
  }
  out.putImageData(pixels, x, y);
  return output;
}

function overlap(a, b) {
  const [x, y, w, h] = a.box, [X, Y, W, H] = b.box;
  const intersection = Math.max(0, Math.min(x + w, X + W) - Math.max(x, X)) *
    Math.max(0, Math.min(y + h, Y + H) - Math.max(y, Y));
  return intersection / Math.min(w * h, W * H);
}

export async function detectObjects(image, threshold) {
  const detector = await engine('objects.tflite');
  const { width: w, height: h } = image;
  const regions = [[0, 0, w, h]];
  if (w / h >= 1.45) {
    const size = Math.ceil(w * .66);
    regions.push([0, 0, size, h], [w - size, 0, size, h]);
  } else if (h / w >= 1.45) {
    const size = Math.ceil(h * .66);
    regions.push([0, 0, w, size], [0, h - size, w, size]);
  }
  const candidates = [];
  for (const [left, top, width, height] of regions) {
    const scale = Math.min(1, 1100 / Math.max(width, height));
    const input = canvas(width * scale, height * scale);
    context(input).drawImage(image, left, top, width, height, 0, 0, input.width, input.height);
    const sx = input.width / width, sy = input.height / height;
    for (const hit of detector.detect(input).detections) {
      const category = hit.categories[0];
      if (!category || category.score < threshold) continue;
      const { originX, originY, width: boxWidth, height: boxHeight } = hit.boundingBox;
      if (boxWidth <= 0 || boxHeight <= 0) continue;
      const atBorder = originX < 4 || originY < 4 || originX + boxWidth > input.width - 4 || originY + boxHeight > input.height - 4;
      const box = [left + originX / sx, top + originY / sy, boxWidth / sx, boxHeight / sy];
      candidates.push({ x: clamp(box[0] + box[2] / 2, 0, w - 1), y: clamp(box[1] + box[3] / 2, 0, h - 1),
        box, label: category.categoryName, score: category.score, rank: category.score * (atBorder ? .92 : 1) });
    }
    input.width = input.height = 1;
    await yieldFrame();
  }
  const matches = [];
  for (const candidate of candidates.sort((a, b) => b.rank - a.rank)) {
    const same = matches.some(item => {
      const fraction = overlap(item, candidate);
      const smaller = Math.min(item.box[2] * item.box[3], candidate.box[2] * candidate.box[3]);
      const larger = Math.max(item.box[2] * item.box[3], candidate.box[2] * candidate.box[3]);
      return fraction > .56 && smaller / larger > (item.label === candidate.label ? .28 : .66);
    });
    if (!same) matches.push(candidate);
  }
  return matches.sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 150);
}
