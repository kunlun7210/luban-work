import { canvas, context, draw } from './image.mjs';
import { recognize } from './paddle.mjs?v=3';
export { recognize };

export function orient(image, rotation) {
  if (!rotation) return image;
  const swapped = rotation % 180 !== 0;
  const result = canvas(swapped ? image.height : image.width, swapped ? image.width : image.height);
  const painter = context(result);
  painter.translate(result.width / 2, result.height / 2);
  painter.rotate(rotation * Math.PI / 180);
  painter.drawImage(image, -image.width / 2, -image.height / 2);
  return result;
}

function linePositions(length, otherLength, dark) {
  const positions = [];
  const required = otherLength * .38;
  for (let i = 0; i < length; i++) {
    let start = -1, last = -4, longest = 0;
    for (let j = 0; j < otherLength; j++) {
      if (!dark(i, j)) continue;
      if (j - last > 5) start = j;
      last = j;
      longest = Math.max(longest, j - start + 1);
    }
    if (longest >= required) positions.push(i);
  }
  const lines = [];
  for (const pos of positions) {
    const last = lines.at(-1);
    if (last && pos - last.end <= 4) last.end = pos;
    else lines.push({ start: pos, end: pos });
  }
  return lines;
}

function findGrid(image) {
  const { width, height } = image;
  const pixels = context(image, true).getImageData(0, 0, width, height).data;
  function intensity(x, y) {
    const i = (y * width + x) * 4;
    return pixels[i + 3] < 128 ? 2550 : 3 * pixels[i] + 6 * pixels[i + 1] + pixels[i + 2];
  }
  function stroke(x, y, dx, dy) {
    const level = intensity(x, y);
    if (level < 1510) return true;
    if (level > 2370) return false;
    const before = intensity(Math.max(0, x - dx), Math.max(0, y - dy));
    const after = intensity(Math.min(width - 1, x + dx), Math.min(height - 1, y + dy));
    return Math.max(before, after) - level > 135;
  }
  const horizontal = linePositions(height, width, (y, x) => stroke(x, y, 0, 3));
  const vertical = linePositions(width, height, (x, y) => stroke(x, y, 3, 0));
  const prune = lines => lines.filter((line, i) => !i || line.start - lines[i - 1].end > 7);
  const xs = prune(vertical), ys = prune(horizontal);
  if (xs.length < 2 || ys.length < 2 || xs.length + ys.length < 5 || xs.length > 41 || ys.length > 101) return null;
  return { xs, ys };
}

function joinWords(words) {
  return words.map(word => word.text).join(' ').replace(/([\p{Script=Han}]) +(?=[\p{Script=Han}])/gu, '$1');
}

function cellBounds(pixels, width, grid, row, col) {
  const left = grid.xs[col].end + 2, right = grid.xs[col + 1].start - 2;
  const top = grid.ys[row].end + 2, bottom = grid.ys[row + 1].start - 2;
  let minX = right, minY = bottom, maxX = left, maxY = top, count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] > 128 && 3 * pixels[offset] + 6 * pixels[offset + 1] + pixels[offset + 2] < 1900) {
        minX = Math.min(x, minX); minY = Math.min(y, minY);
        maxX = Math.max(x, maxX); maxY = Math.max(y, maxY);
        count++;
      }
    }
  }
  if (count < 9) return null;
  const cellArea = (right - left) * (bottom - top);
  if (count > cellArea * .7) return { x: left, y: top, width: right - left, height: bottom - top, row, col };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, row, col };
}

async function readGrid(image, grid, progress, signal) {
  const pixels = context(image, true).getImageData(0, 0, image.width, image.height).data;
  const matrix = Array.from({ length: grid.ys.length - 1 }, () => Array.from({ length: grid.xs.length - 1 }, () => []));
  const nonempty = [];
  for (const [row, cells] of matrix.entries()) {
    for (const col of cells.keys()) {
      const bounds = cellBounds(pixels, image.width, grid, row, col);
      if (bounds) nonempty.push(bounds);
    }
  }
  if (nonempty.length > 480) throw new Error('表格内容过多，请裁成多个不超过 480 个有内容单元格的区域。');

  // Space cells apart before detection so that adjacent columns cannot be
  // recognized as a single line. Map each detected line back to its own cell.
  const laneWidth = 522;
  const laneHeight = 118;
  const batchSize = 16;
  let totalConfidence = 0, lineCount = 0;
  for (let start = 0; start < nonempty.length; start += batchSize) {
    signal.throwIfAborted();
    const subset = nonempty.slice(start, start + batchSize);
    const board = canvas(laneWidth * 2, laneHeight * Math.ceil(subset.length / 2));
    const painter = context(board);
    painter.fillStyle = 'white';
    painter.fillRect(0, 0, board.width, board.height);
    painter.imageSmoothingQuality = 'high';
    for (const [index, source] of subset.entries()) {
      const scale = Math.min(4, 74 / source.height, (laneWidth - 64) / source.width);
      const targetX = index % 2 * laneWidth + 25;
      const targetY = Math.floor(index / 2) * laneHeight + (laneHeight - source.height * scale) / 2;
      painter.drawImage(image, source.x, source.y, source.width, source.height,
        targetX, targetY, source.width * scale, source.height * scale);
    }
    const report = message => progress(message.startsWith('加载') ? message :
      '识别单元格 ' + (start + 1) + '–' + (start + subset.length) + ' / ' + nonempty.length + '…', start / nonempty.length);
    const { words } = await recognize(board, { detail: true }, report, signal);
    for (const word of words) {
      const x = Math.floor((word.x + word.width / 2) / laneWidth);
      const y = Math.floor((word.y + word.height / 2) / laneHeight);
      const cell = x >= 0 && x < 2 && subset[y * 2 + x];
      if (!cell) continue;
      matrix[cell.row][cell.col].push(word);
      totalConfidence += word.confidence;
      lineCount++;
    }
  }
  return {
    matrix: matrix.map(row => row.map(cell => joinWords(cell.sort((a, b) => a.y - b.y || a.x - b.x)))),
    confidence: lineCount ? Math.round(totalConfidence / lineCount) : 0,
  };
}

function borderlessRows(words) {
  const sorted = [...words].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows = [];
  for (const word of sorted) {
    const center = word.y + word.height / 2;
    const row = rows.at(-1);
    if (row && Math.abs(row.center - center) < Math.min(row.height, word.height) * .65) {
      row.words.push(word);
      row.center += (center - row.center) / row.words.length;
    } else {
      rows.push({ center, height: word.height, words: [word] });
    }
  }
  return rows.map(row => {
    const groups = [];
    for (const word of row.words.sort((a, b) => a.x - b.x)) {
      const last = groups.at(-1);
      if (last && word.x - last.right < row.height * .9) {
        last.words.push(word);
        last.right = Math.max(last.right, word.x + word.width);
      } else {
        groups.push({ x: word.x, right: word.x + word.width, words: [word] });
      }
    }
    return groups;
  });
}

function tableFromAlignment(words, columns) {
  const rows = borderlessRows(words);
  const typical = words.map(word => word.height).sort((a, b) => a - b)[Math.floor(words.length / 2)] || 16;
  const anchors = [];
  for (const chunk of rows.flat().sort((a, b) => a.x - b.x)) {
    const last = anchors.at(-1);
    if (last && chunk.x - last.x < typical * 1.15) {
      last.count++;
      last.x += (chunk.x - last.x) / last.count;
    } else {
      anchors.push({ x: chunk.x, count: 1 });
    }
  }
  const size = columns || Math.max(1, ...rows.map(row => row.length));
  const best = anchors.toSorted((a, b) => b.count - a.count).slice(0, size).map(a => a.x).sort((a, b) => a - b);
  return rows.map(row => {
    const cells = Array.from({ length: size }, () => []);
    let previous = -1;
    for (let i = 0; i < row.length; i++) {
      const chunk = row[i];
      let closest = Math.max(previous + 1, 0), distance = Infinity;
      const limit = Math.min(size - 1, Math.max(closest, size - row.length + i));
      for (let col = closest; col <= limit; col++) {
        const error = Math.abs((best[col] ?? Infinity) - chunk.x);
        if (error < distance) [closest, distance] = [col, error];
      }
      const cell = Math.min(size - 1, closest);
      cells[cell].push(...chunk.words);
      previous = cell;
    }
    return cells.map(joinWords);
  });
}

export async function extractTable(input, options, progress, signal) {
  progress('分析表格结构…');
  const scale = Math.min(1, 2200 / Math.max(input.width, input.height));
  const image = scale === 1 ? input : draw(input, input.width * scale, input.height * scale);
  const grid = options.structure === 'borderless' ? null : findGrid(image);
  if (!grid && options.structure === 'grid') throw new Error('未找到清晰的表格框线。请裁掉表格外的区域，或改用无框线模式。');
  let result;
  if (grid) {
    result = await readGrid(image, grid, progress, signal);
  } else {
    const { words, confidence } = await recognize(image, { detail: true }, progress, signal);
    result = { matrix: tableFromAlignment(words, options.columns), confidence };
  }
  const { matrix, confidence } = result;
  if (!matrix.length || !matrix.some(row => row.some(Boolean))) throw new Error('没识别出表格文字，请检查清晰度和旋转方向。');
  if (matrix.length > 120 || matrix[0].length > 40) throw new Error('结果超过 120 行或 40 列，请分区处理。');
  return { matrix, confidence, structure: grid ? '有框线 · 逐格识别' : '按文字对齐' };
}
