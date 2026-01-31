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
    id: 'wenyu',
    name: '文娱',
    description: '娱乐圈/文艺圈，文娱产业与明星成长',
  },
  {
    id: 'niandai_siheyuan',
    name: '年代四合院',
    description: '年代生活流，四合院人情世故与家长里短',
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
    id: 'moshi',
    name: '末世',
    description: '末世题材，秩序崩塌与生存博弈',
  },
  {
    id: 'tongren',
    name: '同人',
    description: 'IP衍生与二创，同人世界观再构筑',
  },
  {
    id: 'dushi_yineng',
    name: '都市异能',
    description: '都市背景下的异能觉醒与对抗',
  },
  {
    id: 'xitong',
    name: '系统',
    description: '系统任务/奖励驱动，爽点节奏清晰',
  },
  {
    id: 'shitu',
    name: '仕途',
    description: '体制内成长，权力博弈与人情世故',
  },
  {
    id: 'banzhu_chihu',
    name: '扮猪吃虎',
    description: '低调隐忍，关键时刻反转打脸',
  },
  {
    id: 'dushi_gaowu',
    name: '都市高武',
    description: '都市与武道结合，高燃对决与升级',
  },
  {
    id: 'qunxiang',
    name: '群像',
    description: '多角色并行推进，群体命运交织',
  },
  {
    id: 'kehuan_moshi',
    name: '科幻末世',
    description: '科幻设定下的末日危机与文明重建',
  },
  {
    id: 'kesulu',
    name: '克苏鲁',
    description: '不可名状与神秘学，理智崩坏的恐惧',
  },
  {
    id: 'wangyou',
    name: '网游',
    description: '虚拟网游世界，副本与竞技成长线',
  },
  {
    id: 'wuxianliu',
    name: '无限流',
    description: '多世界轮回闯关，副本挑战与规则博弈',
  },
  {
    id: 'fanpai',
    name: '反派',
    description: '反派视角或黑化成长，反套路推进',
  },
  {
    id: 'gaoxiao_qingsong',
    name: '搞笑轻松',
    description: '轻松搞笑节奏，日常段子与欢乐氛围',
  },
  {
    id: 'duonvzh',
    name: '多女主',
    description: '多线情感与角色互动，主线推进不拖沓',
  },
  {
    id: 'naodong',
    name: '脑洞',
    description: '创意设定爆发，反常规展开与惊喜点子',
  },
  {
    id: 'zhanshen',
    name: '斩神',
    description: '神话体系对抗，斩神升级与高燃战斗',
  },
  {
    id: 'lingqi_fusu',
    name: '灵气复苏',
    description: '灵气回归，超凡崛起与世界秩序重塑',
  },
  {
    id: 'wunaoshuang',
    name: '无脑爽',
    description: '高频爽点，快速打脸与强势推进',
  },
  {
    id: 'kuqing',
    name: '苦情',
    description: '情感拉扯与虐点，命运起伏与催泪',
  },
  {
    id: 'kongbu',
    name: '恐怖',
    description: '惊悚氛围与压迫感，悬疑恐惧升级',
  },
  {
    id: 'anhei_canku',
    name: '暗黑残酷',
    description: '残酷现实与黑暗叙事，代价与牺牲感强',
  },
  {
    id: 'rexue_jigang',
    name: '热血激昂',
    description: '高燃热血，强目标推进与情绪爆点',
  },
  {
    id: 'zhidou',
    name: '智斗',
    description: '谋略对弈与反转，信息差与博弈升级',
  },
  {
    id: 'guanchang',
    name: '官场',
    description: '官场生态与权谋斗争，规则与人性碰撞',
  },
];

export const categories = {
  male: maleCategories,
  female: femaleCategories,
};