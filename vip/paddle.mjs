import { canvas, context } from './image.mjs';

const asset = name => new URL('./vendor/paddle/' + name, import.meta.url).href;
let active;

// The worker is the official PaddleOCR.js 0.4.2 bundle. Its message envelope
// is pinned alongside the worker and the matching ONNX Runtime Web binaries.
function connect() {
  const worker = new Worker(asset('paddle-worker.mjs'), { type: 'module' });
  const connection = {};
  let requestId = 0;
  const pending = new Map();
  function terminate(error) {
    worker.terminate();
    if (active === connection) active = undefined;
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  }
  worker.addEventListener('error', event => {
    terminate(new Error(event.message || '无法启动本地 OCR 引擎，请刷新后重试。'));
  });
  worker.addEventListener('message', ({ data }) => {
    if (data.kind !== 'worker-transport-response') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    clearTimeout(request.timeout);
    if (data.status === 'success') request.resolve(data.payload);
    else request.reject(new Error(data.error?.message || '文字识别引擎运行失败。'));
  });

  function request(type, payload, transferable = []) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => terminate(new Error('本地 OCR 超时，请缩小图片或重试。')), 90000);
      pending.set(id, { resolve, reject, timeout });
      try {
        worker.postMessage({ kind: 'worker-transport-request', requestId: id, type, payload }, transferable);
      } catch (error) {
        pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
  const det = 'PP-OCRv6_small_det';
  const rec = 'PP-OCRv6_small_rec';
  connection.ready = request('init', {
    options: {
      pipelineConfig: {
        modelSelection: { textDetectionModelName: det, textRecognitionModelName: rec },
        assets: { det: { url: asset(det + '.tar') }, rec: { url: asset(rec + '.tar') } },
        runtimeDefaults: {},
        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 4,
        warnings: [],
      },
      ortOptions: {
        backend: 'wasm',
        numThreads: 1,
        disableWasmProxy: true,
        wasmPaths: {
          mjs: asset('ort-wasm-simd-threaded.mjs'),
          wasm: asset('ort-wasm-simd-threaded.wasm'),
        },
      },
    },
  });
  connection.request = request;
  connection.terminate = terminate;
  return connection;
}

function readLines(result) {
  const words = [];
  for (const { poly, text, score } of result.items) {
    if (!text.trim() || !poly?.length) continue;
    const x = Math.min(...poly.map(point => point[0]));
    const y = Math.min(...poly.map(point => point[1]));
    const width = Math.max(...poly.map(point => point[0])) - x;
    const height = Math.max(...poly.map(point => point[1])) - y;
    if (![x, y, width, height, score].every(Number.isFinite) || width < 1 || height < 1) continue;
    words.push({ text: text.trim(), x, y, width, height, confidence: Math.round(score * 100) });
  }
  return {
    words,
    text: words.map(word => word.text).join('\n'),
    confidence: words.length ? Math.round(words.reduce((sum, word) => sum + word.confidence, 0) / words.length) : 0,
  };
}

export async function recognize(image, options, progress, signal) {
  signal.throwIfAborted();
  if (!globalThis.createImageBitmap || !globalThis.OffscreenCanvas) {
    throw new Error('当前浏览器不支持本地 OCR。请使用支持离屏画布的新版浏览器。');
  }
  if (!active) {
    progress('加载 PaddleOCR 检测与识别模型…');
    active = connect();
  }
  const current = active;
  const stop = () => current.terminate(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  try {
    await current.ready;
    signal.throwIfAborted();
    progress('检测文本区域并识别…');
    const input = canvas(image.width, image.height);
    const painter = context(input);
    painter.fillStyle = '#fff';
    painter.fillRect(0, 0, input.width, input.height);
    painter.drawImage(image, 0, 0);
    const bitmap = await createImageBitmap(input);
    input.width = input.height = 1;
    if (signal.aborted) {
      bitmap.close();
      signal.throwIfAborted();
    }
    const [result] = await current.request('predict', {
      sources: [{ kind: 'imageBitmap', imageBitmap: bitmap }],
      params: {
        textDetLimitSideLen: options.detail ? 1664 : 1280,
        textDetLimitType: 'max',
        textDetMaxSideLimit: 1920,
        textDetBoxThresh: 0.42,
        textRecScoreThresh: 0.35,
      },
    }, [bitmap]);
    return readLines(result);
  } catch (error) {
    if (active === current) current.terminate(error);
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
