import { canvas, clamp, context, exportImage } from './image.mjs';

const labels = {
  person: '人', bicycle: '自行车', car: '汽车', motorcycle: '摩托车', airplane: '飞机', bus: '公交车', train: '火车',
  truck: '卡车', boat: '船', bird: '鸟', cat: '猫', dog: '狗', horse: '马', sheep: '羊', cow: '牛', elephant: '大象',
  bear: '熊', zebra: '斑马', giraffe: '长颈鹿', backpack: '背包', umbrella: '雨伞', handbag: '手提包', tie: '领带',
  suitcase: '行李箱', frisbee: '飞盘', skis: '滑雪板', snowboard: '单板滑雪板', kite: '风筝', skateboard: '滑板',
  surfboard: '冲浪板', bottle: '瓶', cup: '杯', fork: '叉', knife: '刀', spoon: '勺', bowl: '碗', banana: '香蕉',
  apple: '苹果', sandwich: '三明治', orange: '橙子', broccoli: '西蓝花', carrot: '胡萝卜', pizza: '披萨', donut: '甜甜圈',
  cake: '蛋糕', chair: '椅子', couch: '沙发', bed: '床', toilet: '马桶', tv: '电视', laptop: '笔记本电脑', mouse: '鼠标',
  remote: '遥控器', keyboard: '键盘', microwave: '微波炉', oven: '烤箱', toaster: '烤面包机', sink: '水槽',
  refrigerator: '冰箱', book: '书', clock: '钟', vase: '花瓶', scissors: '剪刀', toothbrush: '牙刷',
  'cell phone': '手机', 'sports ball': '球', 'wine glass': '酒杯', 'teddy bear': '泰迪熊', 'potted plant': '盆栽', 'dining table': '餐桌',
  'traffic light': '交通信号灯', 'fire hydrant': '消防栓', 'stop sign': '停车标志', bench: '长椅',
};

export default function countView(image, detections, name, { element, button, save, notify }) {
  const stage = canvas(image.width, image.height);
  stage.className = 'count-stage editing';
  stage.setAttribute('aria-label', '带计数标记的图片');
  const total = element('p', { className: 'count-total', role: 'status' });
  const legend = element('p', { className: 'hint' });
  const selected = element('select', { 'aria-label': '要删除的标记' });
  let marks = [...detections];
  const history = [];
  const paint = context(stage);
  function redraw() {
    paint.clearRect(0, 0, stage.width, stage.height);
    paint.drawImage(image, 0, 0);
    const radius = Math.max(9, Math.max(stage.width, stage.height) / 80);
    const groups = new Map();
    selected.replaceChildren(...marks.map((mark, index) => element('option', { value: String(index) }, '标记 ' + (index + 1))));
    for (const [index, mark] of marks.entries()) {
      const { x, y, box, label } = mark;
      const caption = labels[label] || label || '手动标记';
      groups.set(caption, (groups.get(caption) || 0) + 1);
      if (box) {
        paint.lineWidth = Math.max(2, radius / 5);
        paint.strokeStyle = '#ffbc46';
        paint.strokeRect(...box);
      }
      paint.beginPath();
      paint.arc(x, y, radius, 0, 2 * Math.PI);
      paint.fillStyle = '#92240b';
      paint.fill();
      paint.strokeStyle = '#fff';
      paint.lineWidth = Math.max(1, radius / 8);
      paint.stroke();
      paint.fillStyle = '#fff';
      paint.textAlign = 'center';
      paint.textBaseline = 'middle';
      paint.font = 'bold ' + Math.floor(radius * 1.15) + 'px system-ui';
      paint.fillText(String(index + 1), x, y);
    }
    total.textContent = '总计 ' + marks.length + ' 个';
    legend.textContent = groups.size ? Array.from(groups, ([label, count]) => label + ' ' + count).join(' · ') : '暂无标记。点击图片或输入坐标添加。';
    remove.disabled = !marks.length;
    undo.disabled = !history.length;
  }
  function change(next) {
    history.push(marks);
    if (history.length > 40) history.shift();
    marks = next;
    redraw();
  }
  stage.addEventListener('click', event => {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) * stage.width / rect.width, 0, stage.width - 1);
    const y = clamp((event.clientY - rect.top) * stage.height / rect.height, 0, stage.height - 1);
    let closest = -1, distance = Math.max(14, 15 * stage.width / rect.width);
    for (const [index, mark] of marks.entries()) {
      const d = Math.hypot(mark.x - x, mark.y - y);
      if (d < distance) [distance, closest] = [d, index];
    }
    change(closest === -1 ? [...marks, { x, y }] : marks.filter((_, i) => i !== closest));
  });
  const remove = button('删除所选标记', () => { if (selected.value !== '') change(marks.filter((_, i) => i !== Number(selected.value))); });
  const undo = button('撤销', () => { if (history.length) { marks = history.pop(); redraw(); } });
  const x = element('input', { type: 'number', min: 0, max: stage.width - 1, required: true, 'aria-label': '标记横坐标' });
  const y = element('input', { type: 'number', min: 0, max: stage.height - 1, required: true, 'aria-label': '标记纵坐标' });
  const add = button('添加标记', () => {
    if (x.reportValidity() && y.reportValidity()) change([...marks, { x: x.valueAsNumber, y: y.valueAsNumber }]);
  });
  const download = button('下载带标记 PNG', async () => {
    try { save(await exportImage(stage), name + '-计数.png'); }
    catch (error) { notify(error.message, true); }
  });
  redraw();
  return element('div', {}, total, stage, legend,
    element('p', { className: 'hint' }, '点击图片空白处添加标记，点击已标记圆点即可删除。'),
    element('div', { className: 'toolbar' }, undo, download),
    element('details', {}, element('summary', {}, '用坐标编辑标记'),
      element('div', { className: 'toolbar table-control' }, element('label', {}, 'X ', x), element('label', {}, 'Y ', y), add),
      element('div', { className: 'toolbar' }, selected, remove)));
}
