const form = document.querySelector('form');
const fileInput = document.getElementById('pdf-file');
const passwordInput = document.getElementById('pdf-password');
const unlock = document.getElementById('unlock');
const cancel = document.getElementById('cancel');
const download = document.getElementById('download');
const status = document.getElementById('pdf-status');
const MAX_SIZE = 50_000_000;

const messages = {
  password: '请输入正确的 PDF 打开密码后重试。',
  signed: '检测到数字签名或签名字段，无法解除保护。',
  unprotected: '这份 PDF 已经没有密码保护，可以直接使用原文件。',
  damaged: '无法读取这份 PDF。文件可能损坏，或使用了此工具不支持的保护方式。',
  failed: '未能生成有效的 PDF 副本。请确认文件完整后重试。',
  engine: 'PDF 引擎加载失败，请检查网络后重试。',
};

let activeJob;
let downloadUrl;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  download.removeAttribute('href');
  download.hidden = true;
}

function finishJob() {
  if (activeJob) {
    clearTimeout(activeJob.timeout);
    activeJob.worker.terminate();
    activeJob = undefined;
  }
  unlock.disabled = false;
  cancel.hidden = true;
}

fileInput.addEventListener('change', () => {
  finishJob();
  clearDownload();
  passwordInput.value = '';
  showStatus('');
});

passwordInput.addEventListener('input', () => {
  finishJob();
  clearDownload();
  showStatus('');
});

cancel.addEventListener('click', () => {
  finishJob();
  passwordInput.value = '';
  showStatus('已取消。');
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (activeJob) return;
  clearDownload();
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size === 0 || file.size > MAX_SIZE) {
    showStatus('请选择一份不超过 50 MB 的非空 PDF。', true);
    return;
  }

  let worker;
  try {
    worker = new Worker('./pdf-worker.js');
  } catch {
    showStatus(messages.engine, true);
    return;
  }
  unlock.disabled = true;
  cancel.hidden = false;
  showStatus('正在准备 PDF 引擎…');

  function fail(message) {
    if (activeJob?.worker !== worker) return;
    finishJob();
    showStatus(message, true);
  }

  activeJob = {
    worker,
    timeout: setTimeout(() => fail('处理超时，请试试较小的 PDF。'), 90_000),
  };
  worker.onerror = () => fail(messages.engine);
  worker.onmessage = ({ data }) => {
    if (activeJob?.worker !== worker) return;
    if (data.status === 'working') {
      showStatus('正在解除保护…');
      return;
    }
    if (data.status !== 'done') {
      fail(messages[data.status] || messages.failed);
      return;
    }

    const result = new Blob([data.bytes], { type: 'application/pdf' });
    downloadUrl = URL.createObjectURL(result);
    download.href = downloadUrl;
    download.download = file.name.replace(/\.pdf$/i, '') + '-已解除保护.pdf';
    download.hidden = false;
    passwordInput.value = '';
    finishJob();
    showStatus('保护已解除，可以下载副本。');
  };
  worker.postMessage({ file, password: passwordInput.value });
});

window.addEventListener('pagehide', () => {
  finishJob();
  clearDownload();
  passwordInput.value = '';
  showStatus('');
});
