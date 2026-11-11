const enginePath = './vendor/qpdf-wasm-0.3.1';
const input = '/input.pdf';
const output = '/output.pdf';

function hasSignature(value) {
  const pending = [value];
  while (pending.length) {
    const object = pending.pop();
    if (!object || typeof object !== 'object') continue;
    if (object['/FT'] === '/Sig' || object['/Type'] === '/Sig' || '/ByteRange' in object ||
        (object['/Type'] === '/Catalog' && '/Perms' in object)) return true;
    for (const child of Object.values(object)) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

self.onmessage = async ({ data: { file, password } }) => {
  const report = status => self.postMessage({ status });
  let qpdf;
  let stdout = [];
  let passwordError = false;
  try {
    importScripts(enginePath + '/qpdf.js');
    // This Emscripten build binds console streams when the module is created.
    console.log = line => stdout.push(line);
    console.error = line => { if (/invalid password/i.test(line)) passwordError = true; };
    qpdf = await Module({
      locateFile: name => enginePath + '/' + name,
      noInitialRun: true,
    });
  } catch {
    report('engine');
    return;
  }

  report('working');
  try {
    qpdf.FS.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    const readInput = [input, '--password=' + password, '--suppress-recovery'];
    const inspected = qpdf.callMain([...readInput, '--json', '--json-key=encrypt', '--json-key=qpdf']);
    if (inspected !== 0) {
      report(passwordError ? 'password' : 'damaged');
      return;
    }
    const inspection = JSON.parse(stdout.join('\n'));
    if (inspection.encrypt?.encrypted === false) {
      report('unprotected');
      return;
    }
    if (inspection.encrypt?.encrypted !== true || !inspection.qpdf) {
      report('damaged');
      return;
    }
    if (password === '' && !inspection.encrypt.userpasswordmatched) {
      report('password');
      return;
    }
    if (hasSignature(inspection.qpdf)) {
      report('signed');
      return;
    }

    stdout = [];
    if (qpdf.callMain([...readInput, '--show-npages']) !== 0) {
      report('damaged');
      return;
    }
    const pageCount = stdout.join('').trim();
    if (qpdf.callMain([...readInput, '--decrypt', '--stream-data=preserve', output]) !== 0 ||
        qpdf.callMain([output, '--suppress-recovery', '--check']) !== 0 ||
        qpdf.callMain([output, '--is-encrypted']) !== 2) {
      report('failed');
      return;
    }
    stdout = [];
    if (qpdf.callMain([output, '--show-npages']) !== 0 || stdout.join('').trim() !== pageCount) {
      report('failed');
      return;
    }

    const bytes = qpdf.FS.readFile(output);
    self.postMessage({ status: 'done', bytes: bytes.buffer }, [bytes.buffer]);
  } catch {
    report('damaged');
  }
};
