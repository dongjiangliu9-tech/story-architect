import { NovelCategory, NovelStyle } from '../types';

// 起点中文网男频分类
export const maleCategories: NovelCategory[] = [
  {
    id: 'xuanhuan',
    name: '玄幻',
    description: '修仙修真，玄幻世界',
  },
  {
    id: 'xianxia',
    name: '仙侠',
    description: '剑仙世界，江湖恩怨',
  },
  {
    id: 'dushi',
    name: '都市',
    description: '现代都市，职场商战',
  },
  {
    id: 'junshi',
    name: '军事',
    description: '军旅生涯，铁血征战',
  },
  {
    id: 'lishi',
    name: '历史',
    description: '穿越历史，风云变幻',
  },
  {
    id: 'kehuan',
    name: '科幻',
    description: '未来科技，宇宙探索',
  },
  {
    id: 'youxi',
    name: '游戏',
    description: '虚拟世界，游戏竞技',
  },
  {
    id: 'xuanyi',
    name: '悬疑',
    description: '推理破案，心理较量',
  },
];

// 起点中文网女频分类
export const femaleCategories: NovelCategory[] = [
  {
    id: 'yanqing',
    name: '言情',
    description: '爱情故事，情感纠葛',
  },
  {
    id: 'gongdou',
    name: '宫斗',
    description: '后宫争宠，权谋算计',
  },
  {
    id: 'chuanyue',
    name: '穿越',
    description: '穿越时空，命运重启',
  },
  {
    id: 'xianxia',
    name: '仙侠',
    description: '修仙问道，江湖风云',
  },
  {
    id: 'kehuan',
    name: '科幻',
    description: '未来世界，科技幻想',
  },
  {
    id: 'dushi',
    name: '都市',
    description: '现代都市，时尚生活',
  },
  {
    id: 'lishi',
    name: '历史',
    description: '古代生活，历史风云',
  },
  {
    id: 'youxi',
    name: '游戏',
    description: '游戏世界，虚拟冒险',
  },
];

// 风格分类
export const novelStyles: NovelStyle[] = [
  {
    id: 'naodong',
    name: '脑洞',
    description: '天马行空，创意无限',
  },
  {
    id: 'heiku',
    name: '黑酷',
    description: '黑暗残酷，现实主义',
  },
  {
    id: 'rexue',
    name: '热血',
    description: '激情四射，热血沸腾',
  },
  {
    id: 'wennuan',
    name: '温暖',
    description: '治愈人心，温馨感人',
  },
  {
    id: 'kehuanliu',
    name: '无限流',
    description: '无限世界，多重挑战',
  },
  {
    id: 'kulong',
    name: '苦龙',
    description: '苦大仇深，逆袭之路',
  },
  {
    id: 'gaoxiao',
    name: '搞笑',
    description: '幽默风趣，欢乐无限',
  },
  {
    id: 'kongbu',
    name: '恐怖',
    description: '惊悚刺激，心跳加速',
  },
  {
    id: 'xuanxu',
    name: '玄虚',
    description: '悬疑推理，智斗升级',
  },
  {
    id: 'qihuan',
    name: '奇幻',
    description: '魔法世界，神奇冒险',
  },
];

export const categories = {
  male: maleCategories,
  female: femaleCategories,
};