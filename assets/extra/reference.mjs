import {choice,field,node,outputLink} from './ui.mjs';

const groups = {
  '可回收物': ['报纸 旧报纸','纸箱 快递纸箱','纸板','书本 旧书','宣传单','玻璃瓶','啤酒瓶','饮料瓶 塑料瓶 矿泉水瓶','易拉罐 铝罐','铁罐','金属锅','金属勺','衣服 旧衣物','床单','铝箔'],
  '湿垃圾': ['剩菜 剩饭 饭菜','米饭','面条','菜叶 蔬菜','果皮','香蕉皮','苹果核','西瓜皮','蛋壳','鱼骨 鱼刺','鸡骨','茶叶 茶渣','咖啡渣','落叶','过期饼干 面包'],
  '有害垃圾': ['过期药品 过期药片','药瓶 药盒','油漆桶','废油漆','荧光灯管 日光灯','节能灯','废水银温度计 水银温度计','充电电池 锂电池','纽扣电池','废杀虫剂','废相片 废胶片','废消毒剂'],
  '干垃圾': ['用过的纸巾 纸巾 餐巾纸','塑料袋','一次性口罩 口罩','尿不湿 纸尿裤','卫生巾','烟蒂 烟头','陶瓷 碎陶瓷','大骨头 猪大骨','贝壳','椰子壳','榴莲壳','毛发 头发','尘土','破旧牙刷','一次性餐具','污染纸盒 油污纸盒','创可贴','猫砂','牙签'],
};
const bitter = [
  '今天的计划很周全，连拖延都排进了日程。',
  '有些路走错了也有收获，比如下次能绕开它。',
  '存了那么多提高效率的方法，最费时间的是挑一个开始。',
  '生活总会给你惊喜，有时是惊喜地发现电梯又坏了。',
  '等状态好了再开始，状态也在等你先开始。',
  '事情没有做完也值得休息，脑子加班同样要算工时。',
  '你以为少做了一件事，其实只是未来的自己接了个班。',
  '清空待办之后最开心的一瞬，是还没想起下一件。',
  '忙着等一个完美时机，通常比动手更累。',
  '买了三本时间管理的书，现在多了三项待办。',
];
const diary = [
  '今天给你分享了天气预报。你回我「知道了」。我决定下次只在下雨前看一遍手机。',
  '你说最近喜欢喝热茶。我买了两杯，把没送出去的那杯慢慢喝完。其实对自己也可以热心一点。',
  '打开聊天框三次，最后把今天想说的话写进了备忘录。这次只说给自己听。',
  '你朋友圈发了一张落日，我也去楼下看了。没有同一片天空，也有差不多的橙色。',
  '昨天我等一个回应，今天我等公交。公交来了，原来有些等待是有时刻表的。',
  '我准备了两张电影票。最后和朋友去看，电影比想象中好看。',
  '想给你看路边那只猫，拍完以后把手机收起来，认真和猫打了个招呼。',
  '因为怕说多了惹人烦，我删了半屏文字。最后留下一句「今天过得还不错」。',
  '以前我把铃声开到最大，怕错过你的消息。今天调成静音，睡了一个好觉。',
  '天气变凉了。我没发那句老套的提醒，自己先添了一件衣服。',
];
const random = records=>records[Math.floor(Math.random()*records.length)];

export const reference={
  'garbage-sort':{
    help:'按上海常见生活垃圾分类查询。特殊物品及外地规则以当地公告为准。',
    fields:[field('query','物品名称','text',{required:true,placeholder:'如 矿泉水瓶、蛋壳、过期药品'})],
    actions:[choice('查询分类',({query})=>{
      const term=query.replace(/\s/g,'').trim();
      if(!term)throw Error('请输入具体物品名称。');
      const panel=node('section',{class:'tool-panel tool-form'});
      const results=[];
      for(const [category,items] of Object.entries(groups)){
        for(const item of items){
          if(item.split(' ').some(word=>word===term||term.length>1&&word.includes(term)))results.push(item.split(' ')[0]+' · '+category);
        }
      }
      if(results.length)panel.append(node('pre',{class:'tool-output'},results.join('\n')));
      else panel.append(node('p',{},'当前词库没有收录这件物品。请查阅当地指引。'));
      panel.append(outputLink('https://lhsr.sh.gov.cn/','上海市绿化和市容管理局'));
      return panel;
    })],
  },
  'soul-words':{fields:[],actions:[choice('再来一句',()=>random(bitter))]},
  'simp-words':{fields:[],actions:[choice('翻一页日记',()=>random(diary))]},
};
