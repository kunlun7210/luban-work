import { context, draw } from './image.mjs';

let worker;
export function colorize(image, saturation, progress, signal) {
  signal.throwIfAborted();
  const painter = context(image, true);
  const { width, height } = image;
  const original = painter.getImageData(0, 0, width, height).data;
  const sample = draw(image, 224, 224);
  const input = context(sample, true).getImageData(0, 0, 224, 224).data;
  return new Promise((resolve, reject) => {
    worker ??= new Worker(new URL('./color-worker.mjs', import.meta.url), { type: 'module' });
    const instance = worker;
    function clean() {
      instance.onmessage = null;
      instance.onerror = null;
      signal.removeEventListener('abort', cancel);
    }
    function cancel() {
      clean();
      instance.terminate();
      worker = undefined;
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
    instance.onerror = () => {
      clean();
      instance.terminate();
      worker = undefined;
      reject(new Error('当前浏览器无法初始化上色引擎，请用新版 Safari 或 Chrome 重试。'));
    };
    instance.onmessage = ({ data }) => {
      if (data.message) progress(data.message, data.fraction);
      else {
        clean();
        if (data.error) reject(new Error(data.error));
        else {
          painter.putImageData(new ImageData(data.pixels, width, height), 0, 0);
          resolve(image);
        }
      }
    };
    instance.postMessage({ original, input, width, height, saturation }, [original.buffer, input.buffer]);
  });
}
