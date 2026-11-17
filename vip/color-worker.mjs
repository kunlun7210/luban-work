import * as ort from './vendor/ort/ort.wasm.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
let model;

async function colorModel() {
  model ??= (async () => {
    const manifestUrl = new URL('./models/color.json', import.meta.url);
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error('上色模型清单无法加载。');
    const { length, chunks } = await response.json();
    const binary = new Uint8Array(length);
    let offset = 0;
    for (const [index, name] of chunks.entries()) {
      const chunk = await fetch(new URL(name, manifestUrl));
      if (!chunk.ok) throw new Error('上色模型加载中断，请重试。');
      const part = new Uint8Array(await chunk.arrayBuffer());
      binary.set(part, offset);
      offset += part.length;
      self.postMessage({ message: '下载上色模型…', fraction: (index + 1) / chunks.length });
    }
    if (offset !== length) throw new Error('上色模型不完整。');
    return ort.InferenceSession.create(binary, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })().catch(error => { model = undefined; throw error; });
  return model;
}

const gammaDecoded = Array.from({ length: 256 }, (_, i) => i <= 10 ? i / 3294.6 : ((i / 255 + .055) / 1.055) ** 2.4);
const epsilon = 216 / 24389;
const slope = 24389 / 27;

function lightness(red, green, blue) {
  const y = .2126729 * gammaDecoded[red] + .7151522 * gammaDecoded[green] + .0721750 * gammaDecoded[blue];
  return y > epsilon ? 116 * Math.cbrt(y) - 16 : slope * y;
}

function invLab(value) {
  const cube = value * value * value;
  return cube > epsilon ? cube : (116 * value - 16) / slope;
}

function gamma(value) {
  if (value <= .0031308) return 3294.6 * value;
  return (1.055 * value ** (1 / 2.4) - .055) * 255;
}

function interpolate(array, width, height, offset, x, y) {
  const clippedX = Math.max(0, Math.min(width - 1, x));
  const clippedY = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(clippedX), top = Math.floor(clippedY);
  const right = Math.min(left + 1, width - 1), bottom = Math.min(top + 1, height - 1);
  const horizontal = clippedX - left, vertical = clippedY - top;
  return (array[offset + top * width + left] * (1 - horizontal) + array[offset + top * width + right] * horizontal) * (1 - vertical) +
    (array[offset + bottom * width + left] * (1 - horizontal) + array[offset + bottom * width + right] * horizontal) * vertical;
}

self.onmessage = async ({ data: { original, input, width, height, saturation } }) => {
  try {
    const session = await colorModel();
    self.postMessage({ message: '预测照片颜色…' });
    const luminance = new Float32Array(224 * 224);
    for (let i = 0; i < luminance.length; i++) {
      luminance[i] = lightness(input[i * 4], input[i * 4 + 1], input[i * 4 + 2]);
    }
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', luminance, [1, 1, 224, 224]) });
    const { dims, data } = output[session.outputNames[0]];
    const [sampleHeight, sampleWidth] = dims.slice(-2);
    self.postMessage({ message: '合成原尺寸图像…' });
    const stepX = sampleWidth / width, stepY = sampleHeight / height;
    const channel = sampleWidth * sampleHeight;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        if (!original[p + 3]) continue;
        const sx = (x + .5) * stepX - .5, sy = (y + .5) * stepY - .5;
        const L = lightness(original[p], original[p + 1], original[p + 2]);
        const A = interpolate(data, sampleWidth, sampleHeight, 0, sx, sy) * saturation;
        const B = interpolate(data, sampleWidth, sampleHeight, channel, sx, sy) * saturation;
        const fy = (L + 16) / 116;
        const X = .95047 * invLab(fy + A / 500), Y = invLab(fy), Z = 1.08883 * invLab(fy - B / 200);
        original[p] = gamma(3.2404542 * X - 1.5371385 * Y - .4985314 * Z);
        original[p + 1] = gamma(-.9692660 * X + 1.8760108 * Y + .0415560 * Z);
        original[p + 2] = gamma(.0556434 * X - .2040259 * Y + 1.0572252 * Z);
      }
    }
    self.postMessage({ pixels: original }, [original.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
