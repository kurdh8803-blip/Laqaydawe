/**
 * 角色定义 —— 基于 2026 年动画电影《牛来》原片参考图提取的造型与设定
 *
 * 原作背景：小牛「牛来」出生时虚弱到站不起来，牛妈妈为他取名「牛来」激励他站起来。
 * 他胆小怕蛇（曾被长得像绳头的草蛇咬过），在母亲与族群庇护下成长；
 * 母亲为保护他死于狼群之口后，牛来彻底觉醒，蜕变为直面生死的族群勇士。
 * 豹拉是失去母亲的小豹，喝牛妈妈的奶水长大，与牛来结为跨种族挚友。
 * 云雀（云玎）是从荒漠飞来的受伤小鸟，在牛来的梦里引导他成长。
 * 草蛇「小绳头」、狼群则是草原考验的化身。
 */

export const CHARACTERS = [
  {
    id: 'xiaoniu',
    name: '牛来',
    title: '觉醒的勇者',
    desc: '出生时连站都站不起来的胆小牛犊。母亲走后，他终于敢直面危险——梦里还和云雀一起飞过整片草原。',
    species: 'cow',
    specialKind: 'fly',
    look: {
      fur: 0xe87a2e,        // 活力橙（图2/图5）
      furDark: 0xc95f1c,
      muzzle: 0xf2d4ae,
      belly: 0xf6e0b8,
      eye: 0x4a2c14,        // 棕色大眼（图5）
      brow: 0x3a2410,       // 坚定浓眉（图5）
      spots: false, horns: false,   // 无角（图1左侧小牛）
      scale: 0.9,           // 最矮小
      girth: 0.98,
    },
    stats: {
      maxHp: 980, walk: 3.1, backWalk: 2.5, weight: 0.88,
      power: 0.92,
      specialName: '飞天小牛弹', // 腾空横向飞撞（图2飞姿）
    },
  },
  {
    id: 'jinbao',
    name: '豹拉',
    title: '跨种族的挚友',
    desc: '失去母亲的小豹，喝牛妈妈的奶水长大。他的尾巴曾被当成草蛇，把胆小的牛来吓得落荒而逃。',
    species: 'leopard',
    specialKind: 'flurry',
    look: {
      fur: 0xd8b02c,        // 黄底（图3）
      furDark: 0x8a6a14,
      muzzle: 0xe8c0a8,     // 粉鼻（图3）
      nose: 0xe08a72,
      belly: 0xe9e9e4,      // 白色大肚皮（图3）
      eye: 0x241a10,
      brow: 0x6a5210,
      spots: true,          // 黑色斑点（图3）
      horns: false,
      earBig: true,         // 圆耳
      scale: 0.95,
      girth: 0.96,
    },
    stats: {
      maxHp: 1000, walk: 2.9, backWalk: 2.4, weight: 0.92,
      power: 0.95,
      specialName: '豹影连踢',   // 近身多段乱舞
    },
  },
  {
    id: 'dazhuang',
    name: '牛妈妈',
    title: '最伟大的母爱',
    desc: '为让站不起来的牛来活下去，她倾注了所有心血，连豹拉都是她喂大的。狼群来袭那晚，她挡在了牛来身前。',
    species: 'cow',
    specialKind: 'rush',
    look: {
      fur: 0xecb733,        // 金黄绒毛（图1中央大黄牛）
      furDark: 0xc8941f,
      muzzle: 0xf0cfb0,     // 粉米色大口鼻
      horn: 0x9a9187,       // 灰色牛角（图1/图6）
      hornTip: 0x6f675e,
      belly: 0xf3d9a6,
      eye: 0x2a1c12,
      brow: 0x5c3d1e,
      spots: false, horns: true, hornGray: true,
      scale: 1.16,          // 体型最大
      girth: 1.12,          // 横向粗壮
    },
    stats: {
      maxHp: 1150, walk: 2.1, backWalk: 1.6, weight: 1.25,   // 重，击退小
      power: 1.22,            // 伤害倍率
      specialName: '护犊冲撞', // 全屏冲锋多段
    },
  },
  {
    id: 'zongniu',
    name: '牛爸爸',
    title: '族群首领',
    desc: '沉默寡言的牛群首领，台词不多肩膀最硬。端着茶杯也压不住火气——狼群来袭时，是他带着勇士们冲了上去。',
    species: 'cow',
    specialKind: 'upper',
    look: {
      fur: 0xc05f1f,        // 棕橙（图4右侧）
      furDark: 0x9c4815,
      muzzle: 0xecc9a8,
      horn: 0x8f867c,       // 灰角（图4）
      hornTip: 0x655d54,
      belly: 0xe8c193,
      eye: 0x2c1a0e,
      brow: 0x241208,       // 粗黑怒眉（图4）
      spots: false, horns: true, hornGray: true,
      scale: 1.05,
      girth: 1.05,
    },
    stats: {
      maxHp: 1050, walk: 2.5, backWalk: 2.0, weight: 1.05,
      power: 1.08,
      specialName: '怒火上勾拳',  // 前步升龙击飞
    },
  },
  {
    id: 'shetou',
    name: '小绳头',
    title: '草蛇突袭者',
    desc: '草原深处的草蛇，因为长得像绳头咬了年幼的牛来一口——从此牛来见着条状物就跑。滑溜、阴冷、快得像一条抽出的绳。',
    species: 'snake',
    specialKind: 'coil',
    look: {
      fur: 0xf0a8a0,        // 玫瑰粉蛇身（参考图）
      furDark: 0x2e5d3a,    // 深绿花纹头
      muzzle: 0xf5c0b8,
      belly: 0xf7c8c0,
      eye: 0xd8e040,        // 蛇瞳黄绿
      brow: 0x1e4028,
      spots: false, horns: false,
      hood: true,           // 眼镜蛇颈盾
      scale: 0.98,
      girth: 0.72,          // 细长
    },
    stats: {
      maxHp: 940, walk: 2.8, backWalk: 2.3, weight: 0.8,
      power: 0.9,
      specialName: '绳影缠绕',   // 连环缠打
    },
  },
  {
    id: 'yunque',
    name: '云雀',
    title: '梦境的引导者',
    desc: '从荒漠飞来、翅膀受伤的小鸟，被牛群收留。牛来把她带进梦里，她在梦中见证了牛来全部的成长。',
    species: 'bird',
    specialKind: 'storm',
    look: {
      fur: 0xd8352f,        // 红色羽衣
      furDark: 0xa82420,
      muzzle: 0xf5c542,     // 黄喙
      belly: 0xe9e6f0,      // 白肚
      eye: 0x1a1420,
      brow: 0x7a1418,
      spots: false, horns: false,
      crest: true,          // 头顶红羽
      scale: 0.92,
      girth: 0.94,
    },
    stats: {
      maxHp: 960, walk: 2.7, backWalk: 2.2, weight: 0.85,
      power: 0.98,
      specialName: '羽毛风暴',   // 空中羽毛轰炸
    },
  },
  {
    id: 'wolf',
    name: '头狼',
    title: '狼群之主',
    desc: '月夜袭击牛群的幕后之主。草原的残酷由它执行——也正是这份残酷，逼出了牛来的勇气。',
    species: 'wolf',
    specialKind: 'pack',
    look: {
      fur: 0x23252c,        // 黑色狼身
      furDark: 0x15161a,
      muzzle: 0xcfe6ef,     // 蓝白口鼻
      belly: 0xcfe6ef,      // 蓝白胸颈
      eye: 0xe8c832,        // 黄色狼瞳
      brow: 0x0a0a0c,
      spots: false, horns: false,
      earTipYellow: true,   // 黄耳尖
      scale: 1.08,
      girth: 1.0,
    },
    stats: {
      maxHp: 1100, walk: 2.4, backWalk: 1.9, weight: 1.2,
      power: 1.15,
      specialName: '狼群围猎',   // 群狼冲锋
    },
  },
];

export function getChar(id) { return CHARACTERS.find(c => c.id === id); }
