export async function zipFiles(entries) {
  const { zip } = await import('./vendor/fflate.mjs');
  return new Blob([await new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (error, result) => error ? reject(error) : resolve(result));
  })], { type: 'application/zip' });
}

function safeCsv(value) {
  const cell = /^[\s\u00a0]*[=+@-]/.test(value) && !/^-?\d+(?:\.\d+)?$/.test(value) ? "'" + value : value;
  return '"' + cell.replaceAll('"', '""') + '"';
}

export function csvBlob(rows) {
  return new Blob(['\ufeff' + rows.map(row => row.map(safeCsv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

function xmlText(value) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function columnName(index) {
  let value = index + 1;
  let letters = '';
  while (value) {
    value--;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

export async function xlsxBlob(rows) {
  const types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const nsR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const nsC = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationship = (type, target) => '<Relationships xmlns="' + nsC + '"><Relationship Id="rId1" Type="' + nsR + '/' + type + '" Target="' + target + '"/></Relationships>';
  const cells = rows.map((row, i) => '<row r="' + (i + 1) + '">' + row.map((value, j) =>
    '<c r="' + columnName(j) + (i + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>',
  ).join('') + '</row>').join('');
  const parts = {
    '[Content_Types].xml': types,
    '_rels/.rels': relationship('officeDocument', 'xl/workbook.xml'),
    'xl/workbook.xml': '<workbook xmlns="' + ns + '" xmlns:r="' + nsR + '"><sheets><sheet name="识别结果" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': relationship('worksheet', 'worksheets/sheet1.xml'),
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + ns + '"><sheetData>' + cells + '</sheetData></worksheet>',
  };
  const encoder = new TextEncoder();
  const zipped = await zipFiles(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, encoder.encode(xml)])));
  return new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
