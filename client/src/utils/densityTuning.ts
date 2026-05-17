import { DensityTuningKey, DensityTuningLevels } from '../types';

export const DENSITY_TUNING_MAX_LEVEL = 5;
export const DENSITY_TUNING_KEYS: DensityTuningKey[] = ['emotion', 'plot', 'element'];

export const DENSITY_TUNING_CONFIG: Record<DensityTuningKey, {
  title: string;
  shortLabel: string;
  description: string;
  promptFocus: string;
}> = {
  emotion: {
    title: '情绪密度',
    shortLabel: '情绪',
    description: '单位篇幅内的压抑、爆发、反转、余震频率',
    promptFocus: '每3句话必须有一次情绪抬升或转折；每30秒设置一个舍不得划走的钩子；每1分钟完成一次压抑到爆发的小闭环；每个中故事或每集结尾留下情绪余震；删除“很生气/很伤心”等空洞表达，改为具体动作、关系代价和失控边缘。',
  },
  plot: {
    title: '桥段密度',
    shortLabel: '桥段',
    description: '有效桥段推进速度、伏笔回收和人物弧光强度',
    promptFocus: '每个高价值桥段必须同时解决当前矛盾、埋下新伏笔、完成人物弧光；压缩解释性废话和重复过场；反转必须意料之外、情理之中；让冲突、信息差、背刺、打脸、目标升级形成连续推进。',
  },
  element: {
    title: '要素解析',
    shortLabel: '要素',
    description: '拆解身份、关系、冲突、欲望等商业要素的因果与组合方式',
    promptFocus: '解析并重排身份反差、关系背刺、复仇打脸、逆袭守护、钱权名安全感与被认可等商业要素：写清每个要素为什么有效、绑定谁的欲望、制造什么代价、触发什么付费爽点；不要机械堆砌，要让要素嵌入人物动机和情节因果。',
  },
};

export const emptyDensityLevels = (): DensityTuningLevels => ({
  emotion: 0,
  plot: 0,
  element: 0,
});

export const normalizeDensityLevels = (levels?: Partial<DensityTuningLevels>): DensityTuningLevels => {
  const base = emptyDensityLevels();
  DENSITY_TUNING_KEYS.forEach(key => {
    const raw = Number(levels?.[key] ?? 0);
    base[key] = Number.isFinite(raw)
      ? Math.min(DENSITY_TUNING_MAX_LEVEL, Math.max(0, Math.floor(raw)))
      : 0;
  });
  return base;
};

export const buildDensityTuningSuggestion = (
  currentLevels: DensityTuningLevels,
  draftLevels: DensityTuningLevels,
  enabled: Record<DensityTuningKey, boolean>,
  mode: 'novel' | 'microdrama' | 'literature' | 'film' = 'novel',
) => {
  const activeKeys = DENSITY_TUNING_KEYS.filter(key => enabled[key] && draftLevels[key] > currentLevels[key]);
  const activeInstructions = activeKeys.map(key => {
    const config = DENSITY_TUNING_CONFIG[key];
    return `- ${config.title}：从第${currentLevels[key]}档提升到第${draftLevels[key]}档。本轮按目标档位一次性强化，要求：${config.promptFocus}`;
  }).join('\n');
  const modeInstructions = mode === 'microdrama'
    ? `\n【微短剧人物弧线专项强化】\n1. 必须设置一个贯穿全剧的主反派/核心压力源：可以是个人、家族、公司、组织、旧案真凶或利益集团，但必须从开局就能制造压力，并在每个中故事中以明线行动、暗线布局、代理人、证据、资源封锁、舆论围剿或关系操控的方式持续存在。\n2. 每个中故事都要说明主反派或核心压力源在本阶段的目标、手段、给主角造成的具体代价，以及被主角反制后如何升级下一阶段压迫；不能像闯关游戏一样每段换一批互不相关的敌人。\n3. 主角必须有长线成长弧线：初始缺陷/执念/误判 -> 每个中故事遭遇打击后的选择变化 -> 能力、心态、关系和价值观逐步改变 -> 终局完成可见蜕变。阶段状态小结必须写出这条弧线当前推进到哪里。\n4. 男女主、重要配角和反派也要有可见弧光：欲望、恐惧、利益、弱点、关系选择必须随剧情改变；不要只写“工具人登场、制造危机、被打脸退场”。\n5. 爱情线不能只是调味台词，必须参与人物弧光：一次试探、护短、误会、吃醋、并肩破局或亲密距离变化，都要改变双方信任、权力位置或下一步选择。`
    : mode === 'literature'
      ? `\n【文学作品人物弧线专项强化】\n1. 本轮重写的首要目标是人物塑造，不是爽点升级。必须为主要人物设计贯穿全书的成长、退化、妥协、醒悟或自我和解弧线，并让每个中故事承担其中一个阶段。\n2. 每个中故事都要写清：人物在本阶段面对的现实压力、内在矛盾、关系选择、行为后果，以及这些后果如何改变他/她对自我、亲密关系、家庭、时代、阶层或地方社会的理解。\n3. 避免脸谱化好人/坏人。对手、施压者和误解者也要有生活来源、利益逻辑、情感软肋和自我辩护，不要写成单纯推动剧情的符号。\n4. 详细剧情要用具体场景承载人物弧光：对话里的迟疑、沉默、让步、撒谎、回避、爆发、错过、补偿，都要比概念说明更重要。\n5. 10个中故事结束时，人物命运、关系变化和主题余韵必须形成完整闭合，不要留下网文式连续追更钩子。`
      : mode === 'film'
        ? `\n【电影节拍人物弧线专项强化】\n1. 本轮重写必须保持《救猫咪》15节拍结构，每个节拍都要有清晰的电影功能、场景调度和主人公选择。\n2. 主人公外部目标、内在缺陷、错误信念和终场蜕变必须贯穿15节拍，不能只做事件升级。\n3. B故事人物必须承载主题，并在第三幕启发主人公解决问题；反派/压力源必须与主人公形成主题镜像。\n4. 详细剧情要用具体可拍场景承载人物弧线：动作、沉默、道具、空间距离、对白潜台词和视觉意象要比概念说明更重要。\n5. 场景规划要服务80-120场电影体量，避免网文中故事、微短剧集卡或剧集化支线。`
      : `\n【人物弧线专项强化】\n1. 主角必须有跨中故事的长期成长弧线：初始缺陷、阶段选择、代价、能力/心态/关系变化、终局蜕变要连续可见。\n2. 重要配角和主要对手也要有欲望、弱点、利益变化和选择后果，避免只作为功能牌出现。`;

  return `这是一次“中故事三密度滑块迭代”，请把当前完整中故事细纲作为基底重写，不要另起炉灶。

【本轮滑块提升】
${activeInstructions}

【三密度总公式】
内容战斗力 = 情绪密度 × 桥段密度 × 要素解析。任何一项不能为零；本轮未勾选的维度也要保持不下降。
${modeInstructions}

【红果核心维度分级打分与同步调节】
请先按改后版本自检并输出0-100分：赛道适配、开局节奏、爽点密度、钩子设计、剧本规范、审核合规、人物塑造、商业潜力。
参考问题基线：赛道适配85、开局节奏78、爽点密度55、钩子设计70、剧本规范30、审核合规20、人物塑造60、商业潜力65。
你必须重点补强低分项：爽点密度要更密更狠但不违规；钩子不能同质化；剧本/细纲格式要更标准；审核合规要降低血腥、敏感、恐怖、露骨暴力表达；人物塑造要从“角色功能”升级为“长期弧线”，配角要从工具人升级为有欲望、有利益、有弱点、有选择后果的人。

【硬性边界】
1. 保留原有中故事数量、编号、主线方向、人物关系和阶段状态。
2. 只做“密度上调后的整体重写”：强化、重排、替换、降噪，不要删除核心设定。
3. 详细剧情不能越写越短：新版每个中故事的「详细剧情」信息量、关键事件数、场景推进层次不得少于原版；禁止把原有详细剧情压缩成摘要、概述或几句总括。
4. 配角第一次出场不能毫无铺垫：重要配角首次登场前必须有传闻、利益线索、关系伏笔、危机预告、他人评价、物件/场景暗示或旧账牵引；登场时要带着清晰欲望、身份压力和与主线的因果连接。
5. 每个中故事的阶段状态小结必须新增或明确包含「人物弧线推进」：写清主角当前心理/能力/关系的变化，重要配角或对手的选择变化，以及这些变化如何牵引下一个中故事。
6. 只要存在男女主，就默认存在感情线；无论男频或女频，中故事超过4集或10章时，至少要有1集或1章明确推进感情线；若可判断为女频，50%以上集数或章节都要推进感情线。
7. 所有推进感情线的单集/单章必须从小故事卡抽卡：英雄救美、歪打正着、比试、贵人相助、临危受命、慧眼识真、因祸得福、打情骂俏、幽默搞笑、装B、以小博大、解谜、冒险之旅、特殊对待、争风吃醋、好感变化、洒狗粮、因爱收益、性暗示（仅限合规暧昧张力）等；并匹配爱情线一级结构：好感度变化、受益、争风吃醋、发展受阻、关系危机、装逼、狗粮。
8. 每个中故事仍必须有详细剧情、钩子设计、阶段状态小结；微短剧要按集推进，网文要能继续拆成小故事/章节；文学作品要按完整大章推进，降低网文味。
9. 所有低合规刺激改用关系压迫、利益夺取、证据反转、公开羞辱、限时危机、权力博弈、身份错位、舆论误会、契约代价、资源封锁、背叛曝光等可发布表达。`;
};

export const extractRedFruitReview = (content?: string) => {
  if (!content?.includes('红果核心维度复盘')) return '';
  const firstMacroIndex = content.search(/【中故事[一二三四五六七八九十\d]+】/);
  const review = firstMacroIndex >= 0 ? content.slice(0, firstMacroIndex) : content;
  return review.trim();
};
