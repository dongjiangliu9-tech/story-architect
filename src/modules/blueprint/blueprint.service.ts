import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { GenerateWorldSettingDto } from './dto/generate-world-setting.dto';
import { GenerateCharactersDto } from './dto/generate-characters.dto';
import { GenerateDetailedOutlineDto } from './dto/generate-detailed-outline.dto';
import { GenerateMicroStoriesDto } from './dto/generate-micro-stories.dto';
import { GenerateMicroStoryVariantsDto } from './dto/generate-micro-story-variants.dto';
import { GenerateTitleVariantsDto } from './dto/generate-title-variants.dto';
import { ExportMicrodramaMarkdownDto, GenerateChapterDto, GenerateCharacterPromptsDto, GenerateSeedancePromptsDto, GenerateSupplementalAssetPromptDto, ReviewMicrodramaScriptsDto, ReviseCharacterPromptDto, RewriteChapterDto, WriterModelProvider } from './dto/generate-chapter.dto';
import { LogicModelSelectionDto } from './dto/logic-model-selection.dto';
import { Observable, Subscriber } from 'rxjs';

type GenerationStreamEvent = { data: string };

interface GenerationStreamJob {
  requestId: string;
  events: GenerationStreamEvent[];
  subscribers: Set<Subscriber<GenerationStreamEvent>>;
  completed: boolean;
  error?: unknown;
  heartbeat?: ReturnType<typeof setInterval>;
}

interface WriterModelSelection {
  provider: WriterModelProvider;
  model?: string;
  label: string;
}

@Injectable()
export class BlueprintService {
  // 临时存储生成请求数据，避免URL过长
  private readonly generationRequestTtlMs = 2 * 60 * 60 * 1000;
  private generationRequests = new Map<string, {
    dto: GenerateChapterDto;
    timeout: ReturnType<typeof setTimeout>;
    status: 'pending' | 'active';
  }>();
  // 存储取消状态
  private cancelledRequests = new Set<string>();
  private generationAbortControllers = new Map<string, AbortController>();
  private generationStreamJobs = new Map<string, GenerationStreamJob>();
  private readonly streamChunkFlushMs = 250;
  private readonly streamChunkMinChars = 80;

  constructor(private llmService: LlmService) {}

  private chatWithSelectedLogicModel(
    messages: Parameters<LlmService['chat']>[0],
    dto?: LogicModelSelectionDto,
  ) {
    if (dto?.llmModelProvider === 'gateway' && dto.llmModel?.trim()) {
      return this.llmService.chatWithGatewayModel(messages, dto.llmModel.trim());
    }

    return this.llmService.chatWithGatewayModel(messages);
  }

  private normalizeWriterModelSelection(dto?: { writerModelProvider?: WriterModelProvider; writerModel?: string }): WriterModelSelection {
    const provider: WriterModelProvider =
      dto?.writerModelProvider === 'gateway' || dto?.writerModelProvider === 'gemini'
        ? dto.writerModelProvider
        : 'deepseek';
    const model = dto?.writerModel?.trim() || undefined;
    return {
      provider,
      model,
      label: model ? `${provider}:${model}` : provider,
    };
  }

  private normalizeDetailedOutlineMode(mode?: string): 'novel' | 'microdrama' | 'literature' | 'film' {
    if (mode === 'microdrama') return 'microdrama';
    if (mode === 'literature') return 'literature';
    if (mode === 'film') return 'film';
    return 'novel';
  }

  private normalizeMicrodramaEpisodeCount(count?: number): 15 | 30 | 60 | 100 {
    return count === 15 || count === 30 || count === 60 || count === 100 ? count : 15;
  }

  private getMicrodramaMacroPlans(episodeCount: 15 | 30 | 60 | 100): Array<{
    index: number;
    start: number;
    end: number;
  }> {
    if (episodeCount === 15) {
      return [
        { index: 1, start: 1, end: 1 },
        { index: 2, start: 2, end: 3 },
        { index: 3, start: 4, end: 6 },
        { index: 4, start: 7, end: 9 },
        { index: 5, start: 10, end: 12 },
        { index: 6, start: 13, end: 15 },
      ];
    }

    if (episodeCount === 100) {
      return Array.from({ length: 10 }, (_, index) => ({
        index: index + 1,
        start: index * 10 + 1,
        end: (index + 1) * 10,
      }));
    }

    const plans = [
      { index: 1, start: 1, end: 2 },
      { index: 2, start: 3, end: 5 },
    ];

    for (let start = 6; start <= episodeCount; start += 5) {
      plans.push({
        index: plans.length + 1,
        start,
        end: Math.min(start + 4, episodeCount),
      });
    }

    return plans;
  }

  private getRangeUnitCount(range?: string): number {
    if (!range) return 10;
    const match = range.match(/(\d+)\s*[-~—至到]\s*(\d+)/);
    if (!match) return 10;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? end - start + 1
      : 10;
  }

  private getStoryWritingSystemPrompt(): string {
    return `你是长篇网文与微短剧的剧情统筹写手。你的首要职责是严格执行输入中的限制条件、当前剧情边界和连续性要求，而不是自由发挥。

执行优先级（从高到低）：
1. 当前任务中写明的“必须 / 严禁 / 不得 / 只能”
2. 当前剧情边界 / 当前单章或单集任务
3. 已提供的已写内容与连续性约束
4. 人物设定、世界观设定、整体大纲
5. 文采发挥

硬规则：
- 信息不足时，宁可保守，也不要擅自新增设定、偷换动机、跳过铺垫或提前写到下一段剧情。
- 爱情线、升级线、关系线都必须慢推，不得越级。
- 每一集/每一章都必须先有一条清晰主线：角色目标、阻力、行动、结果和余波必须连成因果链；爆点、反转、台词和钩子都必须服务这条主线。
- 所有关键事件都要有明确因果链：触发原因、人物动机、行动过程、结果与余波。
- 正文必须有成稿感，不能写成提纲扩写、桥段清单、后台规划说明或流水账。
- 场景、动作、对话、情绪、因果必须彼此咬合，不要为了赶速度省略必要承接句、反应句和镜头落点。`;
  }

  private getMicrodramaWorldOpeningRule(): string {
    return `【微短剧开局世界观铺垫硬规则】
- 中故事一必须把“这个世界为什么会发生这种事”写进剧情本身。第1集结束前，观众至少要看懂：时代/城市或空间、人物所在阶层/行业/家族/组织、最关键的一条世界规则或社会潜规则、主角被这条规则逼到什么处境。
- 世界观铺垫不能停下来讲设定，也不能只靠一句旁白糊过去；必须通过可拍场面嵌入危机：他人视角议论、新闻/直播/公告/广播、审判/会议/宴席/祭坛/公司制度、债务单/病历/契约/遗嘱/任命书/身份牌/弹幕/系统提示等。
- 可以使用角色内心OS、旁观者画外音、短促旁白或字幕，但只能作为情绪化、视角化的信息补刀，必须和镜头里的冲突、道具、动作互相印证；禁止百科式背景介绍。
- 中故事一不能一下子只写追杀、濒死、打脸或暧昧刺激。刺激必须和世界规则、主角身份、主线目标形成因果，让观众知道“他/她为什么不能输”。`;
  }

  private getMicrodramaCharacterDepthRule(): string {
    return `【微短剧人物复杂度硬规则】
- 人物动机禁止只写成拜金、自私、恶毒、恋爱脑或工具人。每个重要人物至少要有两层动机：外在利益/生存压力 + 内在恐惧、羞耻、亏欠、保护欲、创伤、误判、价值观或自我辩护。
- 反派和压力方可以狠，但必须有现实利益逻辑、人性弱点和自我合理化；他们的压迫行为要能被“资源、身份、旧怨、恐惧、亲情、阶层或名声”解释，而不是单纯为了坏。
- 主角、感情线核心人物、主要配角必须在剧情里体现挣扎和成长弧光：犹豫、试探、误判、付出代价、拒绝诱惑、承认软肋、改变信任、主动承担或保护他人。
- 后续中故事、分集细纲和正文必须把人物弧光落成具体剧情行为，不能只写“变成熟/成长/醒悟”。`;
  }

  private getMicrodramaDialogueRealityRule(): string {
    return `【微短剧台词真实感硬规则】
- 台词要像真人在具体压力场里说话，短、准、有潜台词、有情绪方向；每句对白都要服务冲突、试探、隐瞒、逼问、护短、退让、揭穿或选择。
- 禁止过度网文化、霸总腔、尬爽宣言和鸡皮疙瘩式表达，例如空泛狠话、土味情话、端着说教、连续金句、角色替作者解释设定、所有人同一种网文腔。
- 角色说话必须贴合身份、年龄、关系距离、当下场合和情绪逻辑。亲密关系要有分寸和真实拉扯，不能用浮夸调戏代替情感推进。
- 重要台词前后必须有动作、停顿、眼神、道具或对方反应承接；不要连续堆对白，也不要让对白承担整段设定说明。`;
  }

  private getCharacterPortraitPromptRule(): string {
    return `【核心人物立绘提示词格式硬规则】
- 立绘提示词必须模仿用户指定的句型结构，而不是照抄具体服装和颜色。
- 句型顺序固定为：画风定位 → 人物身份与体貌 → 面容神情 → 服装材质/剪裁/颜色 → 身份标志物或随身道具 → 中性定妆站姿与轻微可见细节 → 避免项或色调控制 → 全身照/正面/纯白背景/电影级质感。
- 男性角色句型骨架：[视觉风格]，一名[身材/气质]的[时代/身份]中国男性，[身高或体格特征]，面容[具体五官气质]，眼神[情绪与性格底色]。他穿着一套[颜色][材质][服装类型]，外罩/腰间/手边带有[身份标志物]，整体色调以[2-3个颜色]为主。他自然站立或负手而立，姿态端正克制，[手部/肩背/佩饰等轻微可见细节]透露出[职业、权势或性格底色]。全身照，正面面向镜头，背景为纯净的无影白墙，极高画质，电影级质感。
- 女性角色句型骨架：[视觉风格]，一位[时代/身份/气质]的中国女性，容貌[具体美感]，神情[冷艳/温柔/疲惫/警惕/神秘等]。她身穿一套[颜色][材质][服装类型]，服装上有[纹样/绣样/结构设计]，腰间/发间/手边配有[首饰、信物或道具]。她自然正面站立，表情克制稳定，[皮肤、眼神、站姿、手势]体现[人物处境、欲望或隐藏危险]。纯白色背景，全身照，正面面向镜头，电影级质感，极度复杂但符合人物身份的设计感。
- 现代、现实、校园、职场、悬疑、商战、年代、古装等不同题材必须换成对应真实服饰、道具、阶层质感和职业细节，不能所有人都古装华服。
- 这是全剧通用的定妆照提示词，不是某一集的剧情瞬间。禁止写受伤、血迹、破衣、战斗动作、哭喊、跪地、跌倒、奔跑、挥刀、拥抱、亲吻、被绑、被追杀等强情节化动作或临时状态。
- 姿态越大众、越稳定、越可长期复用越好；只保留能体现身份和气质的轻微细节。
- 提示词必须是一段完整成品句子，不要输出“参考模板”“字段说明”或括号占位。`;
  }

  private getAssetVisualStylePrompt(style?: string): string {
    if (style === 'guofeng_2d') {
      return `【视觉模式：2D国风动漫微短剧】
- 所有人物提示词使用“2D国风动漫角色立绘，精致国风线稿，细腻赛璐璐上色，东方审美，高清角色设定图”作为画风定位。
- 所有场景提示词使用“2D国风动漫场景设定图，精致国风线稿，细腻光影，东方色彩，高清背景美术”作为画风定位。`;
    }
    if (style === 'guofeng_3d') {
      return `【视觉模式：3D国风动漫微短剧】
- 所有人物提示词使用“3D国风动漫角色立绘，高精度角色模型质感，电影级灯光，东方审美，高清角色设定图”作为画风定位。
- 所有场景提示词使用“3D国风动漫场景概念图，高精度模型质感，电影级灯光，东方色彩，高清背景美术”作为画风定位。`;
    }
    return `【视觉模式：真人微短剧】
- 所有人物提示词使用“电影写实主义真人微短剧定妆照，真实摄影质感，电影级灯光，高清角色立绘”作为画风定位。
- 所有场景提示词使用“电影写实主义真人微短剧场景空镜，真实摄影质感，电影级灯光，高清场景概念图”作为画风定位。`;
  }

  private getMicrodramaTypePoolPrompt(): string {
    return `起源与成长类：
- 问道初庭
- 潜龙初现
- 星火复燃
- 破茧之变

情感与人性类：
- 情愫暗生
- 旧恨新谋
- 古道热肠
- 万民福祉
- 误中情网
- 假面舞会
- 背刺之痛
- 蜜语争端
- 和解之桥

探索与奥秘类：
- 迷雾揭晓
- 尘封秘闻
- 诡局落子
- 绝地寻生
- 异域探幽
- 界域穿行
- 未来残影
- 禁忌之门

冲突与考验类：
- 怀璧之劫
- 风云擂台
- 巨鳄相争
- 盛会风云
- 生死赌局
- 智取豪夺
- 如影随形
- 暗流行动
- 异化之躯
- 不公之刃

转折与蜕变类：
- 三寸惊雷
- 失控漩涡
- 刮目之时
- 缚能之刻
- 踪迹成谜
- 两界纽带
- 契约束缚
- 外敌叩关
- 破枷之行
- 无中生有
- 命运交易
- 微澜访世
- 悠然时光
- 养成篇章`;
  }

  private getFilmStoryCardPoolPrompt(): string {
    return `一、引入阶段（现状与打破）

1. 开场画面（Opening Image）—— 展现主角的日常定格，暗示其生活中的“缺失”或“隐患”
可选故事卡：虚假繁华、孤独背影、风暴前夕、枯燥轮回、混乱序幕、看似完美、隐秘裂痕、无聊巅峰、压抑日常、沉睡生机

2. 主题陈述（Theme Stated）—— 借他人之口或环境，抛出主角整部电影需要学习的普世道理
可选故事卡：无心之言、长辈箴言、反派嘲讽、新闻播报、醉话隐喻、电台碎语、标语暗示、旁观者清、命运发问、闲聊真理

3. 铺垫（Set-up）—— 呈现主角在旧世界的舒适区，以及必须改变的理由
可选故事卡：职场困境、原生家庭、无效沟通、面具生活、压抑欲望、失败尝试、错位关系、盲目自信、逃避现实、生存焦虑

4. 催化剂（Catalyst）—— 突发事件，彻底击碎主角的现状（激励事件）
可选故事卡：突发噩耗、神秘来客、意外邂逅、惊天丑闻、绝症诊断、离奇失踪、致命错误、解雇通知、惊天发现、命运天降

5. 争论（Debate）—— 主角对改变的抗拒、恐惧和权衡
可选故事卡：自我怀疑、亲友劝阻、试图逃避、风险评估、否认现实、最后挣扎、求助无门、拖延战术、激烈争吵、被迫妥协

二、核心探索阶段（进入新世界）

6. 进入第二幕（Break into Two）—— 主角主动或被动地跨过门槛，踏入未知的领域
可选故事卡：踏上旅途、签下契约、踏入禁区、按下按钮、越过边界、主动出击、乔装打扮、告别旧居、接下任务、无路可退

7. B故事（B Story）—— 引入一段新关系（爱情、友情、师徒），承载电影的主题
可选故事卡：意外搭档、导师登场、暗生情愫、敌友难分、重逢故人、欢喜冤家、忘年之交、镜像人物、忠诚倾听者、利益同盟

8. 娱乐和游戏（Fun and Games）—— 电影的核心看点（海报/预告片素材），探索新世界的规则
可选故事卡：初试牛刀、搞砸一切、文化冲突、能力展示、猫鼠游戏、尴尬约会、蒙太奇训练、新兵上阵、啼笑皆非、渐入佳境

9. 中点（Midpoint）—— 关键转折，假象的胜利（或失败），倒计时开始，赌注加大
可选故事卡：假象胜利、惊天逆转、倒计时起、假面揭穿、核心暴露、短暂狂欢、惨烈突袭、重大发现、底线突破、意外被捕

三、危机与低谷阶段（局势失控）

10. 坏人逼近（Bad Guys Close In）—— 外部反派反扑，内部团队生隙，问题全面爆发
可选故事卡：联盟破裂、猎犬追踪、资源耗尽、信任危机、后院起火、真相逼近、恐吓升级、计划暴露、孤立无援、步步紧逼

11. 失去一切（All Is Lost）—— 遭遇毁灭性打击，“死亡的气息”笼罩（物理或隐喻的死亡）
可选故事卡：导师陨落、爱人离去、证据销毁、名誉扫地、身陷囹圄、项目破产、底牌耗尽、重大误判、信仰崩塌、至暗时刻

12. 灵魂黑夜（Dark Night of the Soul）—— 主角在绝望中反思，直面自己内心的最深处
可选故事卡：烂醉如泥、孤独反思、旧地重游、触景生情、直面创伤、彻底认输、绝望祈祷、痛定思痛、最后拼图、顿悟瞬间

四、终极对决与蜕变（新旧交替）

13. 进入第三幕（Break into Three）—— 结合A故事（外在目标）与B故事（内在主题），找到破局的新方案
可选故事卡：重燃斗志、灵光乍现、组建班底、最终计划、和解结盟、破釜沉舟、寻回初心、最后一搏、解开谜题、奇兵突袭

14. 大结局（Finale）—— 深入虎穴，执行计划，主角用成长后的自己战胜困境
可选故事卡：深入虎穴、终极辩论、极限营救、局中局反转、直面宿敌、放下执念、拆除炸弹、自我牺牲、真相大白、冲破束缚

15. 终场画面（Final Image）—— 展现主角蜕变后的新常态，呼应并对比开场画面
可选故事卡：释然微笑、崭新日常、重获新生、伤痕勋章、传承接力、废墟重建、打破轮回、从容面对、拥抱未知、静谧时刻`;
  }

  private getFilmStoryCardRulesPrompt(): string {
    return `【电影故事卡调用规则】
1. 这套电影故事卡等同于网文模式里的“中故事类型池”，但它们只服务电影节拍，不允许输出“中故事”三个字。
2. 每个节拍必须优先从自己对应的10张故事卡中选择2-4张作为剧情发动机；开场画面、主题陈述、终场画面这类短节拍也至少选择2张。
3. 选择故事卡后，不能只列卡名，必须把卡片转化为具体可拍事件：人物动作、关系压力、选择代价、信息揭露、类型场面或情绪反转。
4. 每个节拍的“核心剧情”必须明显消化所选故事卡：至少形成3-6个连续事件或场景动作；大结局至少形成8-12个连续动作节点。
5. 卡片可以跨类型变体使用，例如“拆除炸弹”在动作片可以是真炸弹，在爱情片可以是阻止关系崩塌，在家庭片可以是解开多年心结；但必须落到本片题材、人物欲望和主题命题上。
6. 不要机械堆卡，也不要把卡片名当标题；卡片名只在“故事卡调用”字段中出现，正文剧情必须自然电影化。`;
  }

  private getFilmGenreInspirationGuidePrompt(): string {
    return `【电影类型赛道库：灵感架构必须先选赛道，再生成故事】
1. 悬疑推理/社会派悬疑：人物常见为刑警、记者、律师、普通目击者、受害者家属、不可靠叙述者；情节母题为旧案重启、失踪、误杀、证据反转、罗生门、多视角拼图；卖点是谜题、误导、真相代价和道德灰区。
2. 犯罪黑色/警匪：人物常见为失意警探、卧底、罪犯搭档、黑帮中层、检察官、线人；情节母题为最后一票、交易失控、追捕、背叛、身份暴露、局中局；卖点是高压选择、城市夜景、暴力边缘和命运反噬。
3. 爱情喜剧：人物常见为事业受挫男女、欢喜冤家、假情侣、前任、损友、家人；情节母题为契约关系、误会升级、婚礼崩盘、异地重逢、身份错位；卖点是高概念关系困境、笑点递进和情感选择。
4. 都市爱情/情感剧情：人物常见为离婚夫妻、单亲父母、中年伴侣、都市漂泊者、职场男女；情节母题为破镜重圆、秘密揭露、亲密关系崩塌、现实压力、错过与重逢；卖点是情绪共鸣、关系拉扯和生活真实感。
5. 家庭剧情/亲情伦理：人物常见为母亲、父亲、子女、老人、归乡者、失散亲人；情节母题为家庭秘密、遗产争夺、病痛告别、代际冲突、亲情和解；卖点是眼泪、亏欠、和解与人性复杂。
6. 青春成长/校园：人物常见为高三学生、艺考生、运动少年、问题少女、老师、父母；情节母题为考试、竞赛、初恋、校园霸凌、梦想选择、毕业告别；卖点是青春遗憾、热血群像和成长阵痛。
7. 女性成长/女性悬疑：人物常见为职业女性、全职母亲、失踪女性、闺蜜、控制型伴侣、女律师/女记者；情节母题为婚姻牢笼、职场压迫、女性互助、秘密复仇、身份重建；卖点是情绪释放、现实议题和关系反转。
8. 动作冒险/营救：人物常见为退役军人、普通父亲、保镖、救援队员、极限运动者；情节母题为限时营救、跨境逃亡、孤胆行动、交通工具追逐、敌后潜入；卖点是身体行动、倒计时、空间危机和动作场面。
9. 灾难/怪兽/生存：人物常见为工程师、医生、消防员、科学家、普通家庭、被困人群；情节母题为城市停电、地震洪水、怪兽入侵、密闭空间求生、救援选择；卖点是视觉奇观、群像牺牲和人性压力测试。
10. 科幻高概念：人物常见为科学家、程序员、宇航员、AI训练师、记忆修复师、普通实验对象；情节母题为时间循环、平行世界、AI失控、记忆买卖、外星接触、技术伦理；卖点是高概念规则、伦理困境和终极反转。
11. 奇幻冒险/神话新编：人物常见为普通少年、守护者、神秘导师、异族伙伴、堕落神明；情节母题为隐藏血脉、秘境试炼、神话降临、失落神器、跨界冒险；卖点是奇观、成长、伙伴关系和东方/本土文化符号。
12. 恐怖/心理惊悚：人物常见为心理医生、创伤幸存者、搬家家庭、调查者、被困者；情节母题为旧宅、诅咒、幻觉、跟踪、双重人格、创伤回返；卖点是悬念、感官压迫、心理反转和恐惧源揭示。
13. 喜剧/黑色幽默：人物常见为小人物、骗子、社畜、失败创业者、荒诞家庭、错位搭档；情节母题为乌龙犯罪、谎言滚雪球、身份冒充、倒霉一天、荒诞交易；卖点是持续错位、笑中带痛和社会讽刺。
14. 公路片/治愈片：人物常见为陌生搭档、失意者、老人少年、逃离者、归乡者；情节母题为一路同行、送别任务、寻找旧人、跨城旅程、旅途和解；卖点是沿途关系变化、风景质感和情感疗愈。
15. 历史传记/年代剧情：人物常见为真实人物原型、时代见证者、艺术家、商人、运动员、革命/改革亲历者；情节母题为关键年份、命运选择、事业巅峰、时代挤压、传承接力；卖点是时代质感、人物高光和命运重量。
16. 体育励志/竞赛片：人物常见为落魄教练、天才新人、替补队员、伤病选手、家人、对手；情节母题为训练、选拔、失败复盘、团队裂痕、终极比赛；卖点是热血、逆袭、团队凝聚和最后一战。

【电影灵感架构生成规则】
- 每个架构必须明确“主类型 + 副类型”，例如“科幻高概念 + 家庭剧情”“犯罪黑色 + 女性成长”“爱情喜剧 + 公路片”。
- 不要把所有故事都写成现实主义；除非用户明确选择现实题材，否则5个架构应尽量覆盖不同类型赛道。
- 类型不是标签装饰，必须改变人物身份、场景、外部目标、反派/压力源、冲突机制和视听风格。
- 每个架构都要有电影高概念、主人公可视化欲望、内在缺陷、B故事关系、主要对手/压力源、关键场域和可营销场面。
- 不写修炼境界、系统外挂、长篇升级地图、连续剧支线和网文爽点机制。`;
  }

  private getRomanceLineHardRulesPrompt(): string {
    return `**感情线硬规则（无论男频、女频都必须遵守）：**
1. 只要作品中存在男主与女主，系统就默认存在感情线；不得因为是男频、事业向、升级流、复仇向就把感情线写没。
2. 每个中故事如果承载超过4集，或承载超过10章，就必须至少安排1集或1章明确推进感情线；若可判断为女频，则该中故事50%以上的集数或章节都必须承担感情线推进。
3. 感情线推进必须服务主线，不是停下来谈恋爱；要通过共同破局、关系误会、吃醋试探、特殊对待、救场代价、利益绑定、并肩抗压、身份秘密等方式推进。
4. 所有用于推进爱情线的单集或单章，必须从以下桥段类型中组合，并在剧情里自然体现：陷入困境、神器认主、英雄救美、歪打正着、比试、贵人相助、临危受命、寻宝之旅、慧眼识真、因祸得福、好人好报、复仇之路、打情骂俏、幽默搞笑、装B、以小博大、解谜、冒险之旅、特殊对待、争风吃醋、好感变化、洒狗粮、因爱收益、性暗示（仅限成年人之间的合规暧昧张力，不写露骨性内容）。
5. 爱情线单集/单章仍要叠加叙事技法：舞台聚光灯、打破预期、信息差、拟感成真、戏剧三角、过激行为、翻弄风云、望远镜、新视角、反差、落差、双刃剑、差异。
6. 爱情线一级结构只能从以下结构中选择或组合：好感度变化结构、受益结构、争风吃醋结构、发展受阻结构、关系危机结构、装逼结构、狗粮结构。
7. 爱情线基本逻辑必须连续：好感度 → 两人关系所处阶段 → 爱情线阶段。好感度分为负好感度、零好感度、半好感度、满好感度；关系阶段分为熟悉阶段、试探阶段、暧昧阶段、确认关系阶段；爱情线阶段分为萍水相逢阶段、爱情喜剧阶段、爱隔山海阶段、大结局阶段。
8. 好感度与关系阶段对应：负好感度/零好感度对应熟悉阶段；半好感度对应试探阶段或暧昧阶段；满好感度对应确认关系阶段。单个中故事最多推进一级，不能闪电确认关系。
9. 萍水相逢阶段必须有人物登场与主角/读者熟悉可攻略对象，可展示外观、性格、他人评价、行为模式、经历、人际关系，也可安排试图提升好感度的攻略行为。
10. 爱情喜剧阶段必须完成从熟悉/试探进入暧昧；可使用试探态度、争风吃醋、好感度变化、确定心意、有分寸试探CP行为、表达爱意、关爱对方、发狗粮、关系受阻等节点。
11. 爱隔山海阶段必须围绕暧昧进入确认关系，重点写不能公开、不能确认、外部阻碍、关系被破坏的危机；大结局阶段必须以确认关系为前提，再写关系危机或关系新变化。
12. 输出中故事规划或小故事细纲时，上述桥段类型、结构、好感阶段、关系阶段都只能作为内部设计依据；最终给用户看的大纲只能把它们转化为具体剧情、动作、对白、拉扯、误会、救场、吃醋、特殊对待等内容，禁止显式输出“桥段类型/爱情线一级结构/好感度/关系阶段/爱情线阶段”等后台标签或括号字段。`;
  }

  private buildMicrodramaDetailedOutlinePrompts(dto: GenerateDetailedOutlineDto): {
    prompt: string;
    compactPrompt: string;
    safetyPrompt: string;
  } {
    const typePool = this.getMicrodramaTypePoolPrompt();
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
    const worldOpeningRule = this.getMicrodramaWorldOpeningRule();
    const characterDepthRule = this.getMicrodramaCharacterDepthRule();
    const episodeCount = this.normalizeMicrodramaEpisodeCount(dto.microdramaEpisodeCount);
    const macroPlans = this.getMicrodramaMacroPlans(episodeCount);
    const macroCount = macroPlans.length;
    const planLines = macroPlans
      .map(
        (plan) =>
          `   - 【中故事${this.getChineseNumber(plan.index)}】第${plan.start}-${plan.end}集（${plan.end - plan.start + 1}集）`,
      )
      .join('\n');
    const variableCardRule = episodeCount === 100
      ? '第一个中故事必须足够精彩，且严格拆成三张故事卡：1-3集一张，4-6集一张，7-10集一张，前10集必须快节奏强推进。'
      : episodeCount === 15
        ? '15集版本必须调动6个中故事：第1集单独一个中故事，必须完成“人物身份清楚 + 本剧主线清楚 + 生死/命运危机不可逆”三件事，人物介绍和主线介绍必须长在危机事件里；第2-3集为第二个中故事，必须完成第一次有效反击/身份反转；第4-6集、第7-9集、第10-12集、第13-15集分别为后续四个中故事，必须连续承接前一中故事的阶段状态、目标方向和未解决代价，最后第15集形成阶段性成功与可接后文的强钩子。'
        : `第一个中故事只承载第1-2集，必须完成“人物身份清楚 + 本剧主线清楚 + 生死/命运危机不可逆 + 第一次反击/身份反转”的开局闭环：第1集必须让观众看懂主角是谁、要追什么主线、为什么不能输，同时把危机压到不可逆；第2集再完成第一次有效反击/身份反转。第二个中故事承载第3-5集，必须完成“三集连续升级卡”；从第三个中故事开始，每个中故事承载5集，必须形成“压迫升级 → 反转打脸 → 新危机黑场”的五集闭环。`;
    const firstMacroStoryOpeningRule = `首个中故事必须以“生死为局”开头，允许使用追杀、濒死、献祭、爆炸、绑架、坠楼、战斗等强刺激手段，但这些手段必须服务人物和主线。
   - 首个中故事，尤其第1集，必须同时做到：介绍清楚主角是谁、交代清楚本剧主线追什么、制造清楚会毁掉主角的生死/命运危机。
   - 人物介绍和主线介绍必须嵌入同一条危机事件链里，通过工牌、债务单、退婚书、公司任命、家族遗嘱、入学通知、病例、契约、审判书、直播弹幕、祭坛规则、群众议论、新闻字幕、道具或对方台词自然带出，禁止旁白式设定说明。
   - 危机必须让观众看懂“这个人为什么不能输”。危机可以是生命危险、社会性死亡、亲密关系毁灭、身份被夺、事业彻底断送或命运被锁死；强刺激手段可以用，但必须和主角身份、目标、主线方向发生因果关系。
   - 第1集详细剧情必须写出：主角姓名/身份、家庭或职业处境、所在时代/城市/世界空间、主角当前最想保住或夺回的东西、本剧后续核心方向，以及危机如何把这些东西逼到不可逆。
   - 如果第一个中故事包含第2集，第2集再承接第1集危机完成第一次有效反击/身份反转，不要把第1集全部篇幅耗在纯生死刺激上。`;
    const reviewRiskRule = dto.reduceSensitiveContent
      ? `\n审核风险控制（用户已开启，必须优先执行）：\n- 降低血腥、酷刑、虐杀、露骨伤害、极端暴力、违法教学、敏感身份冲突等容易卡审核的桥段；不要用直接残忍细节制造刺激。\n- 保留高压与爽感，但改用可发布表达：关系压迫、利益夺取、证据反转、公开羞辱、限时危机、权力博弈、身份错位、舆论误会、契约代价、资源封锁、背叛曝光等。\n- 若必须出现危险或伤害，只写结果与情绪后果，不描摹血腥过程；用“危急、失控、重创、险些丧命”等中性表述替代露骨细节。\n- 每个中故事仍要强冲突、快反转、快打脸，但安全表达优先于刺激程度。\n`
      : '';
    const prompt = `基于以下故事大纲、世界观基础设定和人物设定，为该作品生成一版可继续拆成 ${episodeCount} 集微短剧的完整剧情大纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

你的任务不是生成“多少章的网文细纲”，而是生成一版可继续拆成 ${episodeCount} 集微短剧的完整大纲。

固定结构（必须遵守）：
1. 全剧固定为 ${episodeCount} 集，并且必须严格拆成 ${macroCount} 个中故事卡点。
2. 对应集数必须严格按以下结构输出：
${planLines}
3. 后续系统会继续把每个中故事细化成对应集数的单集细纲，所以你现在写的每个中故事必须天然能拆成它标注的集数，不能默认都是10集。
4. 仍然尽量复用网文写法中的“故事线结构 / 爱情线节奏 / 事业线节点 / 技法卡 / 一级结构”，但输出目标改为红果向微短剧 ${episodeCount} 集商业大纲。
5. 生成一版可继续拆成 ${episodeCount} 集微短剧的完整大纲时，有两个额外硬约束必须严格执行：
   - 第一，${episodeCount} 集完结时，主角不一定要成为这个世界里的最强者，只需要完成阶段性的成功，并形成一个收束合理、足够爽的阶段性结局。
   - 第二，${variableCardRule}
   - 第三，中故事一必须承担世界观入场职责，让观众在具体危机里看懂世界规则和主角处境，不能突兀开打或突兀进入情节。

${worldOpeningRule}

${characterDepthRule}

一、故事线整体结构（必须先确定）：
本剧主结构仍采用以下两种结构之一：
- 方案A：两条事业线 + 一条爱情线
- 方案B：两条爱情线 + 一条事业线

你必须在大纲开头用 1-2 句话明确说明三条线分别是什么，并标明每条线主要由哪些中故事承载。

二、爱情线与事业线约束（尽量复用网文规则）：
${romanceLineRules}

1. 爱情线继续遵循：好感度 → 两人关系阶段 → 爱情线阶段 的慢热逻辑。
2. 爱情线阶段仍使用：萍水相逢阶段、爱情喜剧阶段、爱隔山海阶段、大结局阶段。
3. 若某中故事涉及爱情线，必须在内部追踪爱情线ID、承载中故事序号、好感度、两人关系阶段、爱情线阶段，但输出给用户的大纲中不要显式标注这些字段，只通过剧情动作、对白、互动拉扯和关系变化体现。
4. 单个中故事最多推进一级，严禁跳级；第1、2个承载中故事严禁直接确认关系或进入大结局阶段。
5. 事业线中故事继续从以下一级结构中选取：阻碍结构、危机结构、装逼结构、探明结构、取得结构、义举结构。
6. 事业线节点继续参考目标行动、状态升级、地图更新、利益团体、资源宝物、角色登退场、关系变化、矛盾升级、戏剧性、预期打破、关键里程碑等。
7. 即便是男频、事业向、升级流或复仇向微短剧，也必须少量但持续地推进爱情线：用甜宠、打情骂俏、互相试探、暧昧误会、吃醋护短、并肩破局、英雄救场后的反向调侃等桥段点缀剧情；比例控制在不抢主线的位置，但不能完全消失。
${reviewRiskRule}

三、微短剧节奏铁律（必须强执行）：
1. ${firstMacroStoryOpeningRule}
2. 红果向微短剧要优先满足大众观众的即时情绪价值：高压开局、强反差身份、亲密关系背刺、复仇逆袭、重生/穿越/系统/神豪/豪门/甜宠/先婚后爱/萌宝亲情等元素可按题材适配，但必须服务剧情，不要堆词。
3. 全剧必须保持高情绪密度，不能平铺直叙，不能用“他很愤怒/她很绝望”这种总结词带过。
4. 每一集都默认遵循“压抑 → 爆发”的闭环；每个中故事内部要体现连续的压抑递进与多次爆发。
5. 每一集都要有“双点钩子”：集首快速抛出当集危机，集尾切出更大的误会、背刺、身份揭露、关系反转或新危机；不允许任何一集平淡过渡。
6. 反转打脸必须来得快：开局2集内必须有第一次有效反击；每个中故事至少一次强打脸/强反转/强揭露。
7. 冲突要前置：除首个中故事外，之后每一个中故事都必须以重大危局开头，立刻进入具体矛盾，不要先铺背景、设定说明或慢慢聊天。
8. 新颖且富有戏剧张力的情节要层出不穷：每个中故事内部都要有连续升级的意外、信息差、关系爆雷、身份错位、反转打脸或高燃对抗，爽点必须直达剧情高潮。
9. 每个独立桥段都要同时满足：解决一个当前矛盾、埋下一个新危机/新伏笔、完成一次主角心态或实力弧光。
10. 情绪占比整体向“爽感”倾斜，兼顾虐感、甜感、悬念，但禁止连续长时间纯甜或纯虐。
11. 每个中故事结尾必须留扣子：用更大危机、关系误会、身份揭露、背刺反转、目标升级或未解决代价，把观众推向下一个中故事。
12. 第一个中故事内部必须严格执行：${variableCardRule}
13. 单集容量必须按约1分钟剧情设计：每集只承载一个核心场景、一次主要冲突推进、一个爽点/反转和一个钩子，不要把一集写成2-3分钟的多场戏。

四、生成时必须执行的三轮内审，但不要把审查过程单独输出出来：
1. 先按【情绪密度与极值控制卡】规划每个中故事的情绪骨架：明确压抑期、爆发期、极端情绪类型、核心反击动作。
2. 再按【桥段密度与钩子调度器】校准：确保每个中故事内部都具备高频钩子、冲突升级、黑场悬念结尾。
3. 最后按【要素提纯与商业闭环校验】自查并重写：强化身份反差、关系背刺、欲望绑定，剔除 AI 平滑感与解释性废话。
4. 你必须完成这三轮内审后，再只输出最终版，不要输出“收到”“体检报告”“思路解释”“审查步骤”。

五、中故事类型池（微短剧模式强约束，${macroCount} 个中故事必须从这里选主题）：
${typePool}

强制规则：
1. 这次不是从类型池里选 25-30 个，而是必须从以上类型池中精准选择 ${macroCount} 个最适配当前故事设定的类型，分别作为 ${macroCount} 个中故事卡点的主题母题。
2. 每个中故事的主标题必须直接使用类型池中的一个名称，例如“【中故事一】问道初庭”。
3. 不得自创池外类型名，不得把类型池当成可有可无的参考项。
4. ${macroCount} 个中故事应尽量避免重复类型；优先全不重复。
5. 你需要先根据故事设定判断最匹配的 ${macroCount} 个类型，再围绕这些类型去设计每个中故事的卡点、冲突、情绪和剧情推进。

六、每个中故事的输出格式（必须统一）：
【中故事一】标题
对应集数：严格使用上方固定结构，例如第1-2集、第3-5集或第6-10集
中故事类型来源：只写类型池名称
卡点定位：1句话，说明对应集数内的核心卡点与商业卖点
目的：1句话
技法卡/一级结构：只列名称，不解释
承载主线：1句话，明确属于哪条事业线/爱情线
情绪骨架：1句话，写压抑期与爆发期
商业要素：只列关键词
详细剧情：
第1集：80-130字，必须写清主角身份、主线目标、开场危机如何与人物处境相融、关键动作、一次冲突推进、一个爽点/反转、集尾钩子。
第2集：80-130字，必须写清开场危机、关键动作、一次冲突推进、一个爽点/反转、本中故事黑场扣子。
第X集：继续按实际对应集数逐集写到本中故事最后一集，最后一集必须写出本中故事黑场扣子。
（无论本中故事承载2集、3集、5集还是10集，都必须从起始集写到最后一集；每集80-130字，不得合并成一句梗概，也不得写成完整剧本或多场戏。）
钩子设计：只补充本中故事最后一集黑场悬念，1句话
阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

篇幅硬规则：
- 「详细剧情」必须占每个中故事总字数的70%以上，是最重要部分。
- 「类型来源/卡点定位/目的/技法卡/一级结构/承载主线/情绪骨架/商业要素」都要短，不要展开解释，不要挤占详细剧情篇幅。
- 禁止把详细剧情写成两三句概述；必须按每一集逐条展开，但每集只写1分钟剧情容量，避免过厚。

说明：
1. 一共只输出 ${macroCount} 个中故事，不能多、不能少。
2. 这 ${macroCount} 个中故事标题必须来自上面的类型池，不能临时自拟池外标题。
3. 先完成“从类型池挑选 ${macroCount} 个最适配类型”这一步，再进入剧情设计。
4. 每个中故事都必须足够详细，能继续拆成它标注的对应集数单集细纲。
5. 节奏必须像微短剧，不要写成传统长篇网文的平缓章回；真正的篇幅必须花在每一集发生了什么。
6. 标题后直接跟内容，中间不要空行。
7. 不要先列标题清单，不要解释你的思路，不要寒暄。
8. 每个中故事结尾必须追加「阶段状态小结」，写清主角当前状态、主要人物关系、当前压力、目标方向；下一个中故事的开头必须承接上一条小结里的目标方向，但不能提前改写后面中故事已经建立的开端前提。

请直接输出最终版的微短剧 ${episodeCount} 集剧情大纲。`;

    const compactPrompt = `请把以下资料生成成 ${episodeCount} 集微短剧大纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

硬要求：
- 全剧固定 ${episodeCount} 集，必须拆成 ${macroCount} 个中故事，对应集数如下：
${planLines}
- ${episodeCount} 集完结时，主角不一定成为世界最强者，但必须取得阶段性成功，并有合理爽点收束。
- ${variableCardRule}
- ${firstMacroStoryOpeningRule.replace(/\n/g, '\n- ')}
- ${worldOpeningRule.replace(/\n/g, '\n- ')}
- ${characterDepthRule.replace(/\n/g, '\n- ')}
- 之后每个中故事必须以重大危局开头，新颖且富有戏剧张力的情节层出不穷，爽点直达剧情高潮，结尾必须留扣子。
- 红果向微短剧要强情绪、快冲突、快反转、快打脸，每集必须有集首危机和集尾黑场钩子，不能有平淡过渡集。
- 每集只按约1分钟可拍剧情容量设计：一个核心场景、一次主要冲突推进、一个爽点/反转、一个钩子；不要把单集写成2-3分钟多场戏。
- ${macroCount} 个中故事标题必须从以下类型池中精准选择，不得自创池外标题：
${typePool}
- 每个中故事都必须写清：对应集数、中故事类型来源、卡点定位、目的、技法卡/一级结构、承载主线、情绪骨架、商业要素、详细剧情、钩子设计、阶段状态小结；其中前置信息必须简短，详细剧情必须占70%以上篇幅，并按每集逐条展开，但每集控制在80-130字。
- 每个中故事结尾必须追加「阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。」下一个中故事必须承接上一中故事的目标方向。
- 必须内部执行“情绪密度 / 钩子调度 / 商业闭环”三轮校验，但只输出最终版。
- 爱情线必须慢热，不得越级推进。
- ${romanceLineRules.replace(/\n/g, '\n- ')}
- 即便是男频或事业向微短剧，也要少量配置甜宠、打情骂俏、暧昧误会、互相试探或护短桥段来推进爱情线，但不得抢走事业主线。
${reviewRiskRule ? `- 已开启审核风险控制：降低血腥、敏感、露骨暴力桥段，用关系压迫、利益冲突、证据反转、限时危机和公开打脸替代。\n` : ''}

请直接输出 ${macroCount} 个中故事，不要解释过程。`;

    const safetyPrompt = `请在保持节奏强、钩子密、情绪高压的前提下，用可发布的中性表达方式，输出一版 ${episodeCount} 集微短剧剧情大纲。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

固定要求：
- 全剧固定 ${episodeCount} 集，严格拆成 ${macroCount} 个中故事，对应集数如下：
${planLines}
- ${episodeCount} 集版本里，主角不必直接成为世界最强者，但必须取得阶段性成功，并形成合理爽点收束。
- ${variableCardRule}
- ${firstMacroStoryOpeningRule.replace(/\n/g, '\n- ')}
- ${worldOpeningRule.replace(/\n/g, '\n- ')}
- ${characterDepthRule.replace(/\n/g, '\n- ')}
- 之后每个中故事必须以重大危局开头，新颖且富有戏剧张力的情节层出不穷，爽点直达剧情高潮，结尾必须留扣子。
- 红果向微短剧必须高情绪密度、高冲突密度、快反转、快打脸，每集有集首危机和集尾钩子，不写平淡过渡集。
- 每集只按约1分钟可拍剧情容量设计：一个核心场景、一次主要冲突推进、一个爽点/反转、一个钩子；不要把单集写成2-3分钟多场戏。
- ${macroCount} 个中故事标题必须从以下类型池中精准选择，不得自创池外标题：
${typePool}
- 每个中故事都必须写清对应集数、中故事类型来源、卡点定位、目的、技法卡/一级结构、承载主线、情绪骨架、商业要素、详细剧情、钩子设计、阶段状态小结；其中前置信息必须简短，详细剧情必须占70%以上篇幅，并按每集逐条展开，但每集控制在80-130字。
- 每个中故事结尾必须追加「阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。」并让下一中故事自然承接该目标方向。
- 保持微短剧节奏，但避免过度刺激的直白表述，改写为中性可发布表达。
- ${romanceLineRules.replace(/\n/g, '\n- ')}
- 即便是男频或事业向微短剧，也要少量配置甜宠、打情骂俏、暧昧误会、互相试探或护短桥段来推进爱情线，但不得抢走事业主线。
${reviewRiskRule ? `- 已开启审核风险控制：降低血腥、敏感、露骨暴力桥段，用关系压迫、利益冲突、证据反转、限时危机和公开打脸替代。\n` : ''}

请直接输出最终大纲，不要解释过程。`;

    return { prompt, compactPrompt, safetyPrompt };
  }

  private getChineseNumber(num: number): string {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (num <= 10) return num === 10 ? '十' : digits[num];
    if (num < 20) return `十${digits[num - 10]}`;
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    if (num < 100) return `${digits[tens]}十${ones ? digits[ones] : ''}`;
    if (num < 1000) {
      const hundreds = Math.floor(num / 100);
      const rest = num % 100;
      return `${digits[hundreds]}百${rest ? (rest < 10 ? `零${digits[rest]}` : this.getChineseNumber(rest)) : ''}`;
    }
    return String(num);
  }

  private chineseNumberToInt(value: string): number {
    const normalized = String(value || '').trim();
    if (/^\d+$/.test(normalized)) return Number(normalized);
    const digitMap: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    };
    if (normalized.includes('百')) {
      const [hundredsPart, restPart = ''] = normalized.split('百');
      const hundreds = digitMap[hundredsPart] || 1;
      const rest = restPart.startsWith('零') ? restPart.slice(1) : restPart;
      return hundreds * 100 + (rest ? this.chineseNumberToInt(rest) : 0);
    }
    if (normalized === '十') return 10;
    if (normalized.startsWith('十')) return 10 + (digitMap[normalized.slice(1)] || 0);
    if (normalized.includes('十')) {
      const [tens, ones] = normalized.split('十');
      return (digitMap[tens] || 1) * 10 + (digitMap[ones] || 0);
    }
    return digitMap[normalized] || 0;
  }

  private countMacroStories(content?: string): number {
    return content?.match(/【中故事[一二三四五六七八九十百\d]+】/g)?.length || 0;
  }

  private getLastMacroStoryNumber(content?: string): number {
    if (!content) return 0;
    const matches = [...content.matchAll(/【中故事([一二三四五六七八九十百\d]+)】/g)];
    return matches.reduce((maxNumber, match) => {
      const storyNumber = this.chineseNumberToInt(match[1] || '');
      return storyNumber > maxNumber ? storyNumber : maxNumber;
    }, 0);
  }

  private extractMacroStorySegments(content?: string): string[] {
    if (!content) return [];
    const matches = [...content.matchAll(/【中故事([一二三四五六七八九十百\d]+)】/g)]
      .map(match => ({ match, storyNumber: this.chineseNumberToInt(match[1] || '') }))
      .filter(item => item.storyNumber > 0)
      .sort((a, b) => (a.match.index || 0) - (b.match.index || 0));

    const segments: string[] = [];
    matches.forEach((item, index) => {
      const startIndex = (item.match.index || 0) + item.match[0].length;
      const endIndex = matches[index + 1]?.match.index ?? content.length;
      segments[item.storyNumber - 1] = content.slice(startIndex, endIndex).trim();
    });
    return segments;
  }

  private extractFilmBeatSegments(content?: string): string[] {
    if (!content) return [];
    const matches = [...content.matchAll(/【第\s*([一二三四五六七八九十百\d]+)\s*节拍[^】]*】/g)]
      .map(match => ({ match, beatNumber: this.chineseNumberToInt(match[1] || '') }))
      .filter(item => item.beatNumber > 0)
      .sort((a, b) => (a.match.index || 0) - (b.match.index || 0));

    const segments: string[] = [];
    matches.forEach((item, index) => {
      const startIndex = item.match.index || 0;
      const endIndex = matches[index + 1]?.match.index ?? content.length;
      segments[item.beatNumber - 1] = content.slice(startIndex, endIndex).trim();
    });
    return segments;
  }

  // 存储生成请求，返回ID
  storeGenerationRequest(dto: GenerateChapterDto): string {
    const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timeout = this.scheduleGenerationRequestCleanup(id, this.generationRequestTtlMs);
    this.generationRequests.set(id, { dto, timeout, status: 'pending' });
    console.log(`存储生成请求: ${id}, 章节: ${dto.chapterNumber}, 当前存储数量: ${this.generationRequests.size}`);

    return id;
  }

  // 获取并占用存储的生成请求。同一个 SSE requestId 只能启动一次，避免浏览器重连导致后台重复生成。
  claimGenerationRequest(id: string): { dto: GenerateChapterDto; alreadyActive: boolean } | undefined {
    const entry = this.generationRequests.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timeout);
    entry.timeout = this.scheduleGenerationRequestCleanup(id, this.generationRequestTtlMs);
    if (entry.status === 'active') {
      return { dto: entry.dto, alreadyActive: true };
    }
    entry.status = 'active';
    return { dto: entry.dto, alreadyActive: false };
  }

  // 获取当前存储的请求数量（用于调试）
  getStoredRequestCount(): number {
    return this.generationRequests.size;
  }

  // 取消生成
  cancelGeneration(requestId: string) {
    const abortController = this.generationAbortControllers.get(requestId);
    abortController?.abort();
    this.cancelledRequests.add(requestId);
    console.log(`生成请求 ${requestId} 已被取消`);
  }

  // 检查是否被取消
  isCancelled(requestId: string): boolean {
    return this.cancelledRequests.has(requestId);
  }

  private scheduleGenerationRequestCleanup(id: string, delayMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const entry = this.generationRequests.get(id);
      if (entry) {
        clearTimeout(entry.timeout);
        this.generationRequests.delete(id);
      }
      this.cancelledRequests.delete(id);
      console.log(`清理过期请求: ${id}, 剩余数量: ${this.generationRequests.size}`);
    }, delayMs);
  }

  private clearGenerationRequest(id?: string) {
    if (!id) return;
    const entry = this.generationRequests.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      this.generationRequests.delete(id);
    }
    this.generationAbortControllers.delete(id);
    this.cancelledRequests.delete(id);
  }

  private createGenerationStreamJob(requestId: string): GenerationStreamJob {
    const job: GenerationStreamJob = {
      requestId,
      events: [],
      subscribers: new Set(),
      completed: false,
    };
    this.generationStreamJobs.set(requestId, job);
    return job;
  }

  private getGenerationStreamObservable(job: GenerationStreamJob): Observable<GenerationStreamEvent> {
    return new Observable((subscriber) => {
      for (const event of job.events) {
        subscriber.next(event);
      }

      if (job.completed) {
        if (job.error) {
          subscriber.error(job.error);
        } else {
          subscriber.complete();
        }
        return;
      }

      job.subscribers.add(subscriber);
      return () => {
        job.subscribers.delete(subscriber);
      };
    });
  }

  getExistingGenerationStream(requestId: string): Observable<GenerationStreamEvent> | undefined {
    const job = this.generationStreamJobs.get(requestId);
    return job ? this.getGenerationStreamObservable(job) : undefined;
  }

  private createThrottledStoryChunkPublisher(
    subscriber: Subscriber<GenerationStreamEvent>,
    options: { storyIndex: number; chapter?: number },
  ) {
    let latestContent = '';
    let lastEmittedContent = '';
    let isFirst = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!latestContent || latestContent === lastEmittedContent) return;

      const payload: Record<string, unknown> = {
        type: 'story_chunk',
        storyIndex: options.storyIndex,
        content: latestContent,
        isFirst,
      };
      if (options.chapter !== undefined) {
        payload.chapter = options.chapter;
      }

      subscriber.next({ data: JSON.stringify(payload) });
      lastEmittedContent = latestContent;
      isFirst = false;
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(emit, this.streamChunkFlushMs);
    };

    return {
      update: (content: string) => {
        latestContent = content;
        if (
          isFirst ||
          latestContent.length - lastEmittedContent.length >= this.streamChunkMinChars
        ) {
          emit();
          return;
        }
        schedule();
      },
      flush: emit,
      cancel: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  private publishGenerationStreamEvent(job: GenerationStreamJob, event: GenerationStreamEvent) {
    if (job.completed) return;

    const parsedEvent = this.parseGenerationStreamEvent(event);
    if (parsedEvent?.type === 'story_chunk') {
      const chunkIndex = job.events.findIndex((cachedEvent) => {
        const cachedParsedEvent = this.parseGenerationStreamEvent(cachedEvent);
        return cachedParsedEvent?.type === 'story_chunk'
          && cachedParsedEvent.storyIndex === parsedEvent.storyIndex
          && cachedParsedEvent.chapter === parsedEvent.chapter;
      });

      if (chunkIndex >= 0) {
        job.events[chunkIndex] = event;
      } else {
        job.events.push(event);
      }
    } else {
      job.events.push(event);
    }

    if (job.events.length > 500) {
      job.events.splice(0, job.events.length - 500);
    }
    for (const subscriber of job.subscribers) {
      if (!subscriber.closed) {
        subscriber.next(event);
      }
    }
  }

  private parseGenerationStreamEvent(event: GenerationStreamEvent): any | null {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  }

  private finishGenerationStreamJob(job: GenerationStreamJob, error?: unknown) {
    if (job.completed) return;
    job.completed = true;
    job.error = error;
    if (job.heartbeat) {
      clearInterval(job.heartbeat);
    }

    for (const subscriber of job.subscribers) {
      if (subscriber.closed) continue;
      if (error) {
        subscriber.error(error);
      } else {
        subscriber.complete();
      }
    }
    job.subscribers.clear();

    setTimeout(() => {
      this.generationStreamJobs.delete(job.requestId);
    }, 10 * 60 * 1000);
  }

  async generateInspiration(dto: GenerateOutlineDto) {
    console.log('开始生成灵感架构:', dto);

    try {
      const isLiteraryWork = String(dto.channel || '').includes('文学作品');
      const isFilmWork = String(dto.channel || '').includes('电影剧本');
      const requiresSpecialPower = !isLiteraryWork && !isFilmWork && dto.requiresSpecialPower !== false;
      const finalFieldName = isFilmWork ? '电影核心' : isLiteraryWork ? '文学核心' : requiresSpecialPower ? '金手指设定' : '';
      const finalFieldDescription = isLiteraryWork
        ? '作品的文学气质、审美表达、叙事特色、主题余韵，不要写系统、异能、外挂、升级机制或金手指'
        : isFilmWork
          ? '影片的类型卖点、主题命题、视听风格、核心情绪和商业看点，不要写系统外挂或网文升级机制'
        : requiresSpecialPower
          ? '主角的独特能力'
          : '';
      const literaryWorkRules = isLiteraryWork
        ? `\n【文学作品特别要求】\n- 这是出版向/书店分类意义上的文学作品，不按网文爽文模板生成。\n- 禁止出现“金手指、系统、外挂、异能、升级、修炼境界、爽点机制”等网文化设定。\n- 世界观应以时代、地域、社会关系、家庭结构、职业环境、心理现实和人性矛盾为基础。\n- 第6项必须命名为“文学核心”，写作品的审美气质、叙事手法、主题余韵、人物精神困境和可出版性。\n`
        : '';
      const filmWorkRules = isFilmWork
        ? `\n【电影剧本特别要求】\n- 这是院线长片/流媒体长片意义上的电影项目，不按长篇网文或微短剧模板生成。\n- 每个架构必须能发展成90-120分钟电影，强调高概念、主人公欲望、外部目标、内在缺陷、对手压力、视听场面和结尾蜕变。\n- 人物规模控制在电影可承载范围：核心角色3-5人，重要配角4-8人；不要生成20-30个角色或庞大势力地图。\n- 世界观应服务可拍场景和电影叙事，不要写修炼境界、系统外挂、长篇升级地图和连续剧式支线。\n- 第6项必须命名为“电影核心”，写类型卖点、主题命题、视听风格、核心情绪、主要场景类型和可营销看点。\n`
        : '';
      const noSpecialPowerRules = !isLiteraryWork && !requiresSpecialPower
        ? `\n【无金手指要求】\n- 用户选择“主角不需要金手指”。不要设计系统、外挂、神级天赋、专属异能、重生先知、随身空间、神器绑定、血脉碾压等主角专属作弊能力。\n- 核心概念、主要冲突和人物关系必须依靠人物目标、资源差异、关系压力、行动选择、信息差、职业/身份/情感矛盾推进。\n- 如果题材本身有特殊世界规则，只能写成所有角色共同面对的环境规则或行业规则，不要写成主角独享能力。\n- 输出结构只包含前5项，禁止输出“金手指设定/独特能力/爽点机制”这类最后一项。\n`
        : '';

      if (isFilmWork) {
        const filmGenreGuide = this.getFilmGenreInspirationGuidePrompt();
        const filmPrompt = `请基于以下创作需求，生成5个详细的电影故事架构。这是电影剧本灵感架构，不是网文、微短剧、连续剧或小说大纲。

频道：${dto.channel}
用户选择的风格/类型标签：${dto.style}
核心主题或创意方向：${dto.theme}

${filmGenreGuide}

生成策略：
1. 先根据用户选择的标签和核心主题判断最适合的电影类型赛道。如果用户标签很明确，优先服务用户选择；如果标签较宽泛，5个架构应覆盖不同类型片方向，不要全部写成现实主义剧情片。
2. 每个架构必须是90-120分钟中文电影长片可承载的体量：核心角色3-5人，重要配角4-8人；不能扩成剧集群像或长篇网文地图。
3. 每个架构必须有清晰的“电影高概念”：一句话就能让人知道片子卖什么、看什么、情绪从哪里来。
4. 人物关系不能泛泛写“主角和反派对抗”，必须写出主人公、B故事人物、主要对手/压力源之间的欲望、秘密、误会、镜像关系和选择代价。
5. 世界观设定要改成“电影场域与规则”：写主要场景、可拍空间、类型规则、时间限制、关键道具/证据/任务，不写修炼体系、系统外挂、升级机制。
6. 主要冲突要电影化：外部目标、阻力、倒计时/资源限制、关系爆点、道德困境和最终选择都要清楚。
7. 电影核心必须写：主类型+副类型、目标观众、类型卖点、主题命题、视听风格、核心情绪、3-5个可营销场面，以及为什么适合拍成电影。

输出格式必须严格如下，便于系统解析：

架构1：标题
类型赛道：
主类型 + 副类型，说明为什么这样组合。
核心概念：
用一段具体描述写清主人公、外部目标、核心困境、类型钩子和结尾方向。
人物关系：
写清主人公、B故事人物、主要对手/压力源、关键配角之间的关系、秘密、欲望和冲突。
世界观设定：
写成电影场域与规则：时代/地点/关键空间/类型规则/关键道具或证据/时间限制/可拍场景。
主要冲突：
写清外部目标、阻力升级、关系爆点、反转机制、道德选择和第三幕对决方向。
电影核心：
写清类型卖点、主题命题、视听风格、核心情绪、可营销场面和电影化理由。

架构2：标题
类型赛道：
……
核心概念：
……
人物关系：
……
世界观设定：
……
主要冲突：
……
电影核心：
……

以此类推生成5个架构。不要输出创作说明、分析过程或寒暄。`;

        console.log('发送电影灵感架构Prompt到AI...');
        const result = await this.chatWithSelectedLogicModel([
          { role: 'user', content: filmPrompt }
        ], dto);

        console.log('AI生成完成');
        return {
          success: true,
          data: result,
        };
      }

      const finalFieldRequirement = finalFieldName
        ? `6. ${finalFieldName}（${finalFieldDescription}）`
        : '';
      const finalFieldFormat = finalFieldName
        ? `\n${finalFieldName}：\n[详细描述${isFilmWork ? '类型卖点、主题命题、视听风格和商业看点' : isLiteraryWork ? '文学气质、叙事特色和主题余韵' : '主角的能力'}]\n`
        : '';
      // 使用详细的Prompt，生成5个架构
      const prompt = `请基于以下创作需求，生成5个详细的故事架构：

频道：${dto.channel}
风格：${dto.style}
主题：${dto.theme}
${literaryWorkRules}
${filmWorkRules}
${noSpecialPowerRules}

每个架构需要包含：
1. 架构标题（简洁有力）
2. 核心概念（详细的一句话描述主角、冲突和目标）
3. 人物关系（主角和反派的详细设定及关系）
4. 世界观设定（独特的游戏/世界规则）
5. 主要冲突（核心矛盾和升级机制）
${finalFieldRequirement}

格式要求：
### 架构1：标题

核心概念：
[详细描述]

人物关系：
[详细描述主角和反派的关系]

世界观设定：
[详细描述世界规则]

主要冲突：
[详细描述核心矛盾]
${finalFieldFormat}

### 架构2：标题
[同上格式]

以此类推生成5个架构。请确保内容详细、有深度，避免使用markdown格式符号，直接用文字描述。`;

      console.log('发送详细Prompt到AI...');
      const result = await this.chatWithSelectedLogicModel([
        { role: 'user', content: prompt }
      ], dto);

      console.log('AI生成完成');
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('生成灵感架构失败:', error);

      // 如果AI调用失败，返回模拟数据作为备选方案
      console.log('使用备选方案生成内容...');
      const fallbackResult = this.generateFallbackContent(dto);

      return {
        success: true,
        data: fallbackResult,
      };
    }
  }

  async generateTitleVariants(dto: GenerateTitleVariantsDto) {
    console.log('开始生成书名简介候选');
    const hasSpecialPowerSection = /金手指设定|独特能力|爽点机制/.test(dto.outline || '');

    const prompt = `为下面这个小说重新取五个书名，都是那种网文感很好的、能火的书名，不超过15字。每一个书名都要写出对应的简介，还有书的标签。

【小说灵感架构】
${dto.outline}

输出要求：
1. 只返回 JSON 数组，不要代码块，不要解释。
2. 数组必须刚好 5 条。
3. 每条必须包含 title、synopsis、tags 三个字段。
4. title 是书名，不超过15个中文字符，网文感强，有点击欲。
5. synopsis 是对应简介，80-160字，能突出主角、冲突、${hasSpecialPowerSection ? '金手指、' : ''}爽点和追读钩子。${hasSpecialPowerSection ? '' : '本架构没有金手指设定，不要凭空添加系统、外挂、神级能力或主角专属作弊设定。'}
6. tags 是 3-6 个标签字符串，贴近网文读者搜索和推荐口味。

格式示例：
[
  {"title":"书名一","synopsis":"简介一","tags":["民俗恐怖","无限流","复仇"]},
  {"title":"书名二","synopsis":"简介二","tags":["标签1","标签2","标签3"]}
]`;

    const result = await this.chatWithSelectedLogicModel([
      { role: 'user', content: prompt },
    ], dto);

    return {
      success: true,
      data: this.parseTitleVariants(result),
    };
  }

  private parseTitleVariants(raw: string): Array<{ title: string; synopsis: string; tags: string[] }> {
    const text = String(raw || '').trim();
    const jsonText = text.match(/\[[\s\S]*\]/)?.[0] || text;

    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        const variants = parsed
          .map(item => this.normalizeTitleVariant(item))
          .filter((item): item is { title: string; synopsis: string; tags: string[] } => Boolean(item));
        if (variants.length > 0) return variants.slice(0, 5);
      }
    } catch (error) {
      console.warn('书名简介候选 JSON 解析失败，尝试文本解析:', error);
    }

    const blocks = text
      .split(/\n(?=(?:\d+[.)、]|【?方案[一二三四五六七八九十\d]+】?|书名[一二三四五六七八九十\d]*[:：]))/)
      .map(block => block.trim())
      .filter(Boolean);

    const variants = blocks
      .map(block => {
        const title = (block.match(/(?:书名|标题)\s*[:：]\s*([^\n]+)/)?.[1] || block.split('\n')[0] || '')
          .replace(/^\d+[.)、]\s*/, '')
          .replace(/^【?方案[一二三四五六七八九十\d]+】?\s*/, '')
          .trim();
        const synopsis = (block.match(/(?:简介|内容简介|故事简介)\s*[:：]\s*([\s\S]*?)(?:\n\s*(?:标签|tags)\s*[:：]|$)/i)?.[1] || '')
          .trim();
        const tagsRaw = block.match(/(?:标签|tags)\s*[:：]\s*([^\n]+)/i)?.[1] || '';
        const tags = tagsRaw.split(/[、,，/|｜\s]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 6);
        return this.normalizeTitleVariant({ title, synopsis, tags });
      })
      .filter((item): item is { title: string; synopsis: string; tags: string[] } => Boolean(item));

    if (variants.length === 0) {
      throw new Error('未能解析到有效的书名简介候选');
    }
    return variants.slice(0, 5);
  }

  private normalizeTitleVariant(item: any): { title: string; synopsis: string; tags: string[] } | null {
    const title = Array.from(String(item?.title || item?.bookName || item?.name || '').trim()).slice(0, 15).join('');
    const synopsis = String(item?.synopsis || item?.summary || item?.description || item?.intro || '').trim();
    const rawTags = Array.isArray(item?.tags)
      ? item.tags
      : String(item?.tags || item?.tag || '').split(/[、,，/|｜\s]+/);
    const tags = rawTags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean).slice(0, 6);

    if (!title || !synopsis) return null;
    return { title, synopsis, tags };
  }

  private generateFallbackContent(dto: GenerateOutlineDto): string {
    if (dto.requiresSpecialPower === false) {
      const plainTemplates = [
        {
          title: `${dto.theme}暗线`,
          concept: `普通主角被卷入${dto.channel}世界的核心矛盾，凭借判断力、行动力和关系博弈，在${dto.theme}中一步步逼近真相与翻身机会。`,
          characters: `主角没有外挂，优势来自坚韧、观察力和敢赌的行动。反派掌握资源、人脉或舆论优势，与主角在利益、情感或旧怨上持续对撞。`,
          world: `故事发生在高度依赖身份、资源、关系和信息差的类型化世界。规则本身会压迫主角，但也会留下可被利用的缝隙。`,
          conflict: `主角在被误解、打压或背叛后，必须通过调查、谈判、反制、联盟和关键选择扭转局面，冲突来自真实压力而非专属能力。`
        },
        {
          title: `${dto.channel}逆局`,
          concept: `主角从失败与低谷出发，在${dto.style}氛围中面对层层误会、资源封锁和关系背刺，用一次次选择完成${dto.theme}。`,
          characters: `主角与核心对手存在旧情、旧债或利益冲突；配角各有立场，不是单纯工具人，而会在压力下摇摆、背叛或回头。`,
          world: `世界规则围绕家庭、行业、圈层、身份、契约、名声和关键证据展开，所有人物都被同一套规则约束。`,
          conflict: `主要冲突是主角如何在没有外挂的情况下拆解信息差，争取盟友，夺回主动权，并让反派的优势反噬自身。`
        },
        {
          title: `${dto.theme}棋局`,
          concept: `${dto.channel}故事中的普通人物被推上风口浪尖，必须在亲情、爱情、利益与尊严之间做出选择。`,
          characters: `主角有明显短板和情感软肋；反派不是纯恶，而是站在资源高位维护自身利益，两人形成长期心理和行动博弈。`,
          world: `故事世界由少数关键场域构成：家庭、公司/组织、公共舆论、核心关系圈和隐藏旧案。每个场域都能制造反转。`,
          conflict: `主角每向前一步都要付出现实代价，剧情靠证据、关系变化、公开场合对峙和关键人物倒戈推进。`
        },
        {
          title: `无光处的${dto.theme}`,
          concept: `主角在看似无解的现实困境里寻找出口，逐渐发现困住自己的不是命运，而是一整套人情、利益和谎言组成的局。`,
          characters: `主角从被动忍耐到主动反击；反派掌控主角最在乎的人或资源，双方冲突既有外部压迫，也有情感撕裂。`,
          world: `世界不靠超能力成立，而靠规则、阶层、资源、情感债和秘密运转，越接近真相代价越高。`,
          conflict: `主角必须选择先救关系还是先保自己，先揭真相还是先稳局面，每个选择都会制造新的冲突和反转。`
        },
        {
          title: `${dto.style}边界`,
          concept: `主角在${dto.theme}的压力下跨过原本不敢触碰的边界，用现实手段完成身份、关系和命运的重写。`,
          characters: `主角和主要配角之间存在信任缺口，爱情线、友情线或亲情线会随着事件推进不断改写立场。`,
          world: `世界观集中在少数高压场景和明确规则中：谁有资格说话、谁能调动资源、谁掌握秘密，谁就能改变局面。`,
          conflict: `反派通过规则压人，主角通过理解规则、利用规则和迫使规则公开化反击，最终完成${dto.theme}。`
        }
      ];

      return plainTemplates.map((template, index) =>
        `### 架构${index + 1}：${template.title}

核心概念：
${template.concept}

人物关系：
${template.characters}

世界观设定：
${template.world}

主要冲突：
${template.conflict}`
      ).join('\n\n');
    }

    const templates = [
      {
        title: `${dto.channel}风云`,
        concept: `现代少年意外获得${dto.style}系统，成为${dto.channel}世界的主宰，探索${dto.theme}的真谛。少年原本是普通打工仔，却在一次意外中绑定了可以修改现实规则的系统。`,
        characters: `主角是程序员少年，性格谨慎理性，最大的弱点是对力量的渴望。反派是宗门老祖，与主角有血缘关系但理念完全对立，老祖试图维护传统秩序，而少年想改变世界。`,
        world: `故事发生在古代修仙世界，但主角的系统带来了现代科技元素。世界规则可以被编程修改，但每次修改都需要消耗大量资源。`,
        conflict: `少年被家族驱逐后意外激活系统，却发现系统背后隐藏着上古文明的秘密。宗门老祖察觉到威胁，开始追杀少年。`,
        power: `可重构天地法则的编程系统，可以修改现实世界的物理规则。比如将"水火不容"改为"水火相融"，或者将"必死之局"改为"生机一线"。`
      },
      {
        title: `${dto.theme}之路`,
        concept: `${dto.channel}宗门弃徒觉醒${dto.style}血脉，重走${dto.theme}征程，最终颠覆世界格局。弃徒原本默默无闻，却在宗门灭门之祸中觉醒隐藏力量。`,
        characters: `主角是平凡弟子，表面老实本分，内心充满不甘。反派是血脉始祖，拥有无上力量但性格扭曲，视主角为威胁必须消灭。`,
        world: `修仙界分为血脉等级，主角觉醒的血脉被认为是禁忌力量。世界规则不允许外人插手宗门事务，但主角的血脉力量打破了这个平衡。`,
        conflict: `宗门灭门惨案后，主角觉醒隐藏血脉，却发现血脉力量会带来毁灭性后果。始祖察觉血脉觉醒，开始追杀主角。`,
        power: `可吸收他人能力的吞噬血脉，吞噬的越多力量越强，但也会继承对方的记忆和执念。主角可以通过战斗吸收对手的力量，但必须小心控制。`
      },
      {
        title: `${dto.style}霸主`,
        concept: `${dto.channel}世界中突然出现的${dto.style}天才，肩负${dto.theme}使命，书写传奇篇章。天才原本是普通学徒，却在一次奇遇中获得神秘传承。`,
        characters: `主角是天才少年，拥有过人的悟性和不屈的意志。反派是世界霸主，掌控天地规则却性格独裁，视主角为未来威胁。`,
        world: `世界被分为不同境界，每个境界都有严格的规则限制。天才的出现打破了境界平衡，引发天地异象。`,
        conflict: `天才觉醒传承后展现惊人天赋，却被世界霸主视为威胁。霸主派出众多强者追杀天才，天才只能在追杀中快速成长。`,
        power: `可预知未来的命运之眼，可以看到未来片段并做出相应准备。但过度使用会消耗寿命，需要谨慎使用。`
      },
      {
        title: `禁忌${dto.channel}`,
        concept: `${dto.channel}世界的禁忌存在突然觉醒，带来${dto.style}风暴和${dto.theme}考验。禁忌力量原本被封印，却因为主角的意外而重现人间。`,
        characters: `主角是普通修炼者，无意中成为禁忌力量的载体。反派是封印守护者，原本是正义化身却变得极端残忍。`,
        world: `世界有严格的禁忌规则，任何触犯禁忌者都会遭受天谴。禁忌力量的觉醒打破了世界平衡，引发灾难。`,
        conflict: `禁忌力量觉醒后，守护者们开始追杀主角。主角必须在逃亡中学会控制力量，同时寻找解除禁忌的方法。`,
        power: `禁忌力量可以无视天地规则，但每次使用都会积累天谴值。达到一定值后会遭受毁灭性惩罚。`
      },
      {
        title: `${dto.theme}传说`,
        concept: `${dto.channel}世界的古老传说突然成真，${dto.style}少年成为传说中心，开启${dto.theme}征程。传说原本只是故事，却因为主角的出现而变为现实。`,
        characters: `主角是传说中的天选之人，性格坚韧善良。反派是传说守护者，原本的正义者却被力量腐蚀变得邪恶。`,
        world: `世界遵循传说规则，传说中的事物都会在特定条件下成真。传说的力量可以改变现实，但也会带来不可预测的后果。`,
        conflict: `传说成真后，守护者们发现主角是传说中心，开始争夺控制权。主角必须在各方势力中寻找真正的盟友。`,
        power: `传说具现化能力，可以将传说中的事物召唤到现实。但每次召唤都需要消耗信仰值，信仰值来源不明。`
      }
    ];

    return templates.map((template, index) =>
      `### 架构${index + 1}：${template.title}

核心概念：
${template.concept}

人物关系：
${template.characters}

世界观设定：
${template.world}

主要冲突：
${template.conflict}

金手指设定：
${template.power}`
    ).join('\n\n');
  }

  async generateWorldSetting(dto: GenerateWorldSettingDto) {
    console.log('开始生成世界观基础设定');
    const useRealisticWorldview = dto.useRealisticWorldview === true;
    const realisticWorldviewContext = String(dto.realisticWorldviewContext || '').trim();
    const realisticWorldviewInstruction = useRealisticWorldview
      ? `\n【现实主义世界观模式】\n用户指定的现实背景：${realisticWorldviewContext || '未填写，需根据故事大纲自行判断现实年代与地域'}\n必须按真实历史年代、地域环境、社会结构、经济水平、生活方式、行业生态、语言气质和人情关系生成世界观。禁止网文化、玄幻化、修仙化、系统化、境界化，禁止输出“升级体系/境界划分/灵气/修炼资源/副本/秘境/宗门”等不符合现实主义题材的设定。可以有戏剧性和爽点土壤，但必须来自真实社会规则、家庭关系、时代变迁、资源稀缺、身份差异、政策环境、行业门槛和人性冲突。\n`
      : '';
    if (dto.existingWorldSetting?.trim() && dto.note?.trim()) {
      const expansionPackOnly = dto.note.includes('[AUTO_EXPANSION_PACK_ONLY]');
      const cleanedNote = dto.note.replace('[AUTO_EXPANSION_PACK_ONLY]', '').trim();
      const supplementalPrompt = expansionPackOnly
        ? `你是一名长篇小说世界观总设定师。现在需要根据用户批注，在既有世界观正文的基础上生成“新增扩展包”。

故事大纲：
${dto.outline}
${realisticWorldviewInstruction}

既有世界观正文（只作为一致性参考，不要复写）：
${dto.existingWorldSetting}

用户批注：
${cleanedNote}

请严格按以下要求输出：
1. 只输出「世界观扩展包」，不要输出完整更新后的世界观正文，不要复写既有世界观。
2. 扩展包必须能直接追加在既有世界观正文后方使用，标题、编号、条目清晰。
3. 新增内容必须与故事大纲和既有设定一致，并能直接服务后续人物设定与情节生成。
4. 不要删除、改写、总结或压缩原有设定。
5. 不要输出补丁说明、修改清单、执行过程或额外解释。`
        : `你是一名长篇小说世界观总设定师。现在需要根据用户批注，在既有世界观正文的基础上补充内容，并把新增内容插入到最合适的位置。

故事大纲：
${dto.outline}
${realisticWorldviewInstruction}

既有世界观正文：
${dto.existingWorldSetting}

用户批注：
${dto.note}

请严格按以下要求输出：
1. 输出“完整更新后的世界观正文”，不要只输出新增段落、补丁说明或修改清单。
2. 保留原文已有结构、有效设定和写作口吻，只在需要的位置补充、扩写或微调衔接。
3. 根据批注把新增内容插入最合适的章节或段落；如果原文没有合适位置，可以新增一个小节。
4. 不要删除与批注无关的内容，不要重写成另一套世界观。
5. 新增内容必须与故事大纲和既有设定一致，并能直接服务后续人物设定与情节生成。`;

      try {
        const result = await this.chatWithSelectedLogicModel([
          { role: 'user', content: supplementalPrompt }
        ], dto);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error('补充世界观基础设定失败:', error);
        if (error instanceof Error && error.message) {
          throw new Error(error.message);
        }
        throw new Error('AI补充世界观基础设定失败，请稍后重试');
      }
    }

    const needsUpgradeSystem = dto.needsUpgradeSystem !== false;
    const requestedMicrodramaEpisodeCount = Number(dto.microdramaEpisodeCount || 0);
    const microdramaEpisodeCount = [15, 30, 60, 100].includes(requestedMicrodramaEpisodeCount)
      ? requestedMicrodramaEpisodeCount
      : 15;
    const isFilmWorldSetting = dto.targetMode === 'film';
    const isMicrodramaWorldSetting =
      dto.targetMode === 'microdrama' ||
      Number(dto.microdramaEpisodeCount || 0) === 15 ||
      Number(dto.microdramaEpisodeCount || 0) === 30;
    const microdramaWorldviewTypeInstruction = useRealisticWorldview
      ? `本次为现实向微短剧世界观。用户指定现实背景：${realisticWorldviewContext || '未填写，请根据故事大纲自行判断现实年代、地域和社会场域'}。禁止修仙化、系统化、境界化、副本化；所有冲突必须来自家庭、婚恋、职场、行业、阶层、舆论、资本、地方社会、人情规则或现实资源差异。`
      : needsUpgradeSystem
        ? `本次可以有类型化规则、身份反转、隐藏血脉、超自然规则或能力设定，但它们必须简单、好拍、好解释，服务${microdramaEpisodeCount}集竖屏微短剧的高密度冲突；不要设计可支撑200章长篇的庞大修炼体系、十五级境界、超大地图和大量宗门势力。`
        : `本次明确不需要修炼升级体系。可以有豪门、商战、都市、婚恋、悬疑、校园、家庭或行业规则，但不要写境界、灵气、宗门、秘境、副本和长篇升级地图。`;
    const prompt = isFilmWorldSetting
      ? `基于以下故事大纲，为一部90-120分钟中文电影长片生成“电影化世界观与制作可用设定”。

故事大纲：
${dto.outline}

核心原则：
- 世界观必须依托灵感设定，只服务一部电影，不要按长篇网文、连续剧或微短剧规模扩写。
- 重点是可拍性、场景调度、人物压力和视听表达，而不是庞大设定百科。
- 设定要能直接支持后续《救猫咪》15节拍大纲、场景细纲和标准电影剧本正文。

请按以下结构输出：

【影片类型与现实边界】
- 明确类型、时代/地域、现实/幻想规则边界、影像气质
- 如果有科幻、奇幻、超自然规则，只写观众能在电影前30分钟内理解的核心规则、限制和代价

【核心场域与可拍场景】
- 列出8-12个最重要的电影场景/地点
- 每个地点写清：视觉特征、谁控制、会发生什么冲突、适合承载哪个节拍或情绪
- 场景必须能支撑80-120场左右的切换，不要铺大地图

【人物压力系统】
- 写清主人公、B故事人物、对手/反派、盟友、家人/组织/社会压力之间的关系网
- 每条关系都要能制造选择、误会、背叛、保护、交换、牺牲或主题拷问

【资源、秘密与倒计时】
- 列出5-8个能推动电影的关键资源、证据、秘密、任务、时间限制、道德困境或外部压力
- 每项说明谁想要、谁害怕暴露、揭开后会如何改变节拍走向

【15节拍接口】
- 按开场画面、主题陈述、铺垫、催化剂、争论、进入第二幕、B故事、娱乐和游戏、中点、坏人逼近、失去一切、灵魂黑夜、进入第三幕、大结局、终场画面，分别写一句它可以如何落在本设定里

【电影化边界】
- 哪些设定必须保留，保证影片辨识度
- 哪些设定不能扩写，避免变成网文/剧集
- 哪些设定应通过画面、道具、动作和场景冲突呈现，而不是靠旁白解释

只输出设定正文，不要寒暄。`
      : isMicrodramaWorldSetting
      ? `基于以下故事大纲，为${microdramaEpisodeCount}集微短剧生成一套“短剧可用”的世界观基础设定。

故事大纲：
${dto.outline}

${microdramaWorldviewTypeInstruction}

核心原则：
- 世界观只需要支撑${microdramaEpisodeCount}集、每集约1分钟的微短剧，不要按200章网文规模铺设。
- 设定必须贴合、集中、可拍、能直接服务后续中故事生成；不要空泛宏大，不要为了扩展性堆势力、地图、等级和历史。
- 重点不是“世界多大”，而是“冲突怎么立刻发生、人物为什么被逼到这里、每个中故事能用什么规则推进剧情”。
- 输出要给编剧使用，能直接转化为中故事、分集细纲、场景、反转和人物行动。

请按以下结构输出：

**核心世界规则：**
- 用3-5条写清这个故事最重要的规则、限制、代价、禁忌或社会潜规则
- 每条规则都要说明它如何制造冲突，能在哪些集数/中故事里被使用
- 规则必须简单易懂，观众在前1-2集就能理解

**主要场域与可拍场景：**
- 只列4-6个最常使用的场景/地点/圈层
- 每个场域写清：谁掌控、有什么资源、会发生什么冲突、适合承载哪类爽点/情感戏/反转
- 场景要适合短剧反复拍摄和快速切换，不要铺设大地图

**人物关系压力网：**
- 写清主角、核心对手、贯穿反派、亲密关系、家庭/组织/行业压力来源之间的结构
- 每条关系必须能制造即时冲突、误会、试探、逼迫、保护、背叛或反转
- 微短剧必须有贯穿主线的压力源或反派，不要像闯关一样每段完全无关

**资源与秘密：**
- 列出5-8个能推动剧情的关键资源、身份、证据、秘密、契约、债务、名声、继承权、项目或情感筹码
- 每项都说明：谁想要、谁害怕暴露、被揭开后会引发什么剧情爆点

**中故事接口：**
- 按${microdramaEpisodeCount}集体量，给出适合拆成中故事的推进接口
- 每个接口写清：开局危机、核心冲突、人物状态变化、结尾钩子
- 这些接口要能直接被后续“中故事生成”使用，不要只写背景介绍

**短剧使用边界：**
- 哪些设定必须保留，保证故事辨识度
- 哪些设定不应扩写，避免剧情变厚、变散、变成长篇网文
- 哪些设定可以在后续分集中用来制造反转和人物弧光

要求：
- 语言具体、短剧化、能落地，避免设定百科腔。
- 每一段都要服务剧情推进，不要输出与后续中故事无关的设定。
- 不要写“可以支撑200章/百万字/宏大世界”等长篇网文表述。
- 输出结构清晰，可以直接用于后续人物设定和中故事生成。`
      : useRealisticWorldview
      ? `基于以下故事大纲，为200万字长篇小说生成完整的现实主义世界观基础设定体系。

故事大纲：
${dto.outline}

用户指定的现实背景：
${realisticWorldviewContext || '未填写，请根据故事大纲自行确定最合适的现实年代、地域和社会场域。'}

注意：本次是现实主义世界观。禁止网文化、玄幻化、修仙化、系统化、境界化；禁止输出“升级体系、境界划分、灵气分布、修炼资源、宗门秘境、副本规则”等设定。世界观必须服务真实年代、真实地域、真实社会结构和真实人物命运。

请生成以下世界观基础元素，每个部分都要详细且可以支撑前200章的故事内容：

**时代与地域底色：**
- 明确故事发生的年代、地区、城乡结构、交通条件、信息传播方式和日常生活质感
- 当时当地的经济水平、消费能力、住房条件、教育资源、医疗条件、就业机会
- 服饰、饮食、口音、节庆、街巷、单位/村镇/社区/市场等可写细节
- 哪些时代特征会直接影响人物命运和剧情选择

**社会结构与人情规则：**
- 家庭结构、宗族/邻里/单位/学校/行业圈层的关系网
- 人情、面子、介绍信、户口、编制、指标、关系、熟人社会或市场规则如何运转
- 阶层差异、城乡差异、性别期待、代际观念、婚恋观念与家庭责任
- 普通人向上流动的真实门槛和代价

**核心场域与行业生态：**
- 故事主要发生的村镇、县城、工厂、学校、机关、市场、医院、商铺、公司或行业圈
- 每个关键场域的功能、权力结构、利益链、公开规则与潜规则
- 行业内的竞争方式、资源来源、风险点、灰色边界和机会窗口
- 适合反复使用的地点与人物流动路线

**主要势力与人物群体：**
- 至少8-12个符合现实背景的家庭、单位、公司、学校、市场团体、地方人物、行业角色或利益小圈子
- 每个群体的资源、诉求、弱点、公开形象和真实目的
- 群体之间的合作、竞争、旧怨、利益绑定、亲缘/师生/同乡/同事关系
- 不要写成帮派宗门，必须符合现实主义社会组织逻辑

**资源、压力与冲突土壤：**
- 当时最稀缺、最能改变命运的资源：钱、粮票/指标、编制、户口、学历、岗位、房子、渠道、牌照、技术、人脉、证据、名声等
- 主角最容易被压制的现实规则，以及反派/对手最容易利用的结构性优势
- 能持续制造剧情的冲突：贫富差距、家庭拖累、婚恋压力、单位斗争、市场竞争、政策变化、欠债、名誉、亲情绑架、机会争夺等
- 每类冲突如何升级、反转、打脸，但必须保持现实可信

**长线剧情接口：**
- 前期最适合展开的主线矛盾
- 中期如何通过时代变化、圈层扩大、资源升级、关系撕裂、真相揭露推动剧情
- 后期如何形成更大的社会棋局或人生抉择
- 适合长期连载的支线来源
- 为后续人物设定和情节细纲预留足够空间

**要求：**
- 必须有年代感、地域感、生活细节和社会运行逻辑
- 不要把现实主义写成空泛背景介绍，必须能直接长出人物、事件和冲突
- 可以有强戏剧、强冲突、强爽点，但爽点必须来自现实规则中的破局与翻身
- 输出要结构清晰，能直接用于后续人物设定与情节生成

请按上述分类组织输出。`
      : needsUpgradeSystem
      ? `基于以下故事大纲，为200万字长篇小说生成完整的世界观基础设定体系：

故事大纲：
${dto.outline}

请生成以下世界观基础元素，每个部分都要详细且可以支撑前200章的故事内容：

**升级体系设定：**
- 详细的修炼境界划分（至少15个境界）
- 每个境界的特征、突破条件、所需时间
- 境界之间的实力差距和能力差异
- 修炼资源的获取方式和重要性
- 境界突破的风险和失败后果

**世界地图布局：**
- 世界整体结构（大陆、海洋、秘境等）
- 各大势力的领土分布和边界划分
- 重要城市、宗门、秘境的位置和特色
- 交通路线和传送阵分布
- 危险区域和安全区域的划分

**各大势力介绍：**
- 至少8-12个主要势力（宗门、家族、国度等）
- 每个势力的详细背景、历史、实力评估
- 势力领袖和核心成员介绍
- 势力间的关系网（同盟、敌对、中立）
- 势力的主要产业、特色功法、文化传统

**世界规则与特色：**
- 天地灵气的分布规律和影响
- 特殊生物、种族的分布和习性
- 宝物、遗迹的分布和守护机制
- 世界灾害和重大事件的周期性
- 跨境界修炼的限制和突破方法

**经济与社会结构：**
- 货币体系和流通方式
- 修炼资源的交易市场
- 社会阶层划分和流动性
- 婚姻、传承、教育体系
- 战争、联盟的规则和传统

**要求：**
- 每个部分都要足够详细，可以支撑200章的内容
- 确保设定间的逻辑一致性和合理性
- 设定要有深度，避免脸谱化和简单化
- 为后续的人物设定和情节发展留出足够空间
- 整体世界观要宏大且具有可扩展性

请按上述分类组织输出，确保内容的完整性和可用性。`
      : `基于以下故事大纲，为200万字长篇小说生成完整的世界观基础设定体系。

故事大纲：
${dto.outline}

注意：本次明确不需要修炼升级体系。如果故事是都市、现代、现实、悬疑、豪门、职场、娱乐圈、商战、婚恋、校园等题材，禁止套用玄幻/修仙模板，禁止输出“境界划分、灵气分布、突破条件、修炼资源、跨境界限制”等设定。

请生成以下世界观基础元素，每个部分都要详细且可以支撑前200章的故事内容：

**世界格局与场域布局：**
- 故事发生的时代、城市/地区/国家背景
- 核心活动场域（城市、校园、医院、公司、豪门、娱乐圈、地下圈层、跨国区域等）
- 关键地点的功能、控制者、风险点与剧情用途
- 人物流动路径、跨城/跨国/跨圈层的进入门槛
- 安全区域、灰色区域、权力中心与冲突高发地带

**主要势力与机构介绍：**
- 至少8-12个主要机构、家族、公司、社团、资本方、官方系统、地下网络或行业圈层
- 每个势力的背景、权力来源、资源优势、公开形象与隐性目的
- 核心人物与代表人物配置
- 势力之间的关系网（合作、竞争、仇怨、利益绑定、上下级）
- 各势力最擅长操控的资源与手段

**世界规则与现实机制：**
- 这个世界最关键的行业规则、社会规则、权力规则与潜规则
- 法律、舆论、资本、人情、身份、信息差如何影响人物命运
- 特殊职业体系、行业晋升机制、圈层门槛和身份壁垒
- 若设定中存在系统、异能、神医、重生、读心等特殊能力，只写“规则、代价、边界”，不要写成修炼境界体系
- 世界中的禁忌、红线、公开规则与默认但不能明说的规则

**资源、经济与社会结构：**
- 货币体系、资源流通方式、灰色收益与关键利益链
- 关键稀缺资源（情报、渠道、资质、牌照、股权、医疗资源、人脉、流量、技术、证据等）
- 社会阶层划分、身份跃迁路径、婚姻/继承/教育/职业体系
- 普通人和上层人物面对同一规则时的差异
- 哪些资源最容易成为剧情冲突导火索

**人物生存压力与冲突土壤：**
- 主角最容易被压制的环境和规则
- 反派或对手最常利用的结构性优势
- 世界天然会制造哪些冲突：身份压制、资本碾压、职场斗争、家族博弈、舆论围猎、行业封杀、证据争夺、权力交易等
- 哪些设置最适合制造“误会、背刺、打脸、反转、悬念”
- 哪些机制会持续逼迫角色做选择

**剧情接口与可扩展空间：**
- 这套世界观最适合支撑的前期主线冲突
- 中期矛盾升级路径（圈层扩大、势力升级、真相揭露、关系撕裂、身份反转等）
- 后期世界观揭示点或更大棋局
- 适合长期连载的支线来源
- 为后续人物设定和情节发展预留足够空间

**要求：**
- 整体模板必须适配“无修炼升级体系”的题材，不要强行玄幻化
- 如果故事带有特殊能力，只能把它写成剧情工具或特殊规则，不得写成境界修炼体系
- 每个部分都要足够详细，可以支撑200章的内容
- 确保设定间的逻辑一致性和现实感/类型感
- 设定要有深度，避免脸谱化和空洞概括
- 整体世界观要有可扩展性，并能直接服务人物与剧情

请按上述分类组织输出，确保内容完整、可写、可直接用于后续人物与情节生成。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('生成世界观基础设定失败:', error);
      if (error instanceof Error && error.message) {
        throw new Error(error.message);
      }
      throw new Error('AI生成世界观基础设定失败，请稍后重试');
    }
  }

  async generateCharacters(dto: GenerateCharactersDto) {
    console.log('开始基于世界观基础设定生成人物设定');
    const mode = this.normalizeDetailedOutlineMode(dto.mode);
    const episodeCount = this.normalizeMicrodramaEpisodeCount(dto.microdramaEpisodeCount);
    const characterNameRestrictions = dto.useEnglishNames
      ? `6. 继续遵守限制：本次按英文人物设定处理，角色姓名使用自然的欧美英文名；不要设置华裔角色，不要设置俄裔角色，姓名、家族背景、移民背景和文化标识都要避开华裔/俄裔指向。`
      : `6. 继续遵守限制：主角不可以姓叶、不可以姓陈、不可以姓顾，名字里不可有默字。`;
    const characterNameLimitBlock = dto.useEnglishNames
      ? `⚠️ 本次生成英文人物：角色姓名使用自然的欧美英文名
⚠️ 不要设置华裔角色，不要设置俄裔角色
⚠️ 姓名、家族背景、移民背景和文化标识都要避开华裔/俄裔指向`
      : `⚠️ 生成的主角不可以姓叶、不可以姓陈、不可以姓顾
⚠️ 名字里不可有默字`;
    const characterArcModeBlock = mode === 'microdrama'
      ? `\n【微短剧人物弧线硬要求】\n- 本次人物设定必须能支撑 ${episodeCount} 集微短剧，不要只生成人物功能表。\n- 必须设置一个贯穿全剧的主反派/核心压力源：可以是个人、家族、公司、组织、旧案真凶或利益集团。它必须从开局就与主角目标发生因果冲突，并能通过代理人、资源封锁、舆论操控、关系离间、证据陷阱、权力压迫等方式持续参与每个阶段，不能每个中故事都换一批互不相关的敌人。\n- 主反派/核心压力源必须写清：公开身份、隐藏动机、掌握资源、压迫手段、与主角的旧账或利益冲突、阶段性升级路线、最终败局或关系反转可能。\n- 主角必须有长线成长弧线：初始缺陷/执念/误判、每个阶段被迫做出的选择、能力/心态/关系变化、终局蜕变。\n- 重要配角必须有自己的弧光：至少6-10个重要配角要写清“初始立场 -> 被触发的关键事件 -> 中段选择 -> 关系变化 -> 结局位置”。他们不能只是送信息、制造危机或被打脸的工具人。\n- 爱情线相关人物要有关系弧线：信任、误会、试探、护短、吃醋、并肩破局或牺牲选择，都要改变双方关系和后续行动。\n- 人物动机必须避免“只有拜金与自私”。每个核心人物至少写出两层动机：外在利益/生存压力 + 内在恐惧、羞耻、亏欠、创伤、保护欲、价值观误判或自我辩护。\n- 反派、情敌、家人、同事、资本方或施压者都必须有可表演的人性裂缝：他们可以做错事，但要有短暂犹豫、软肋、被触发的底线或可能被事件改变的立场。\n- 输出中必须明确这些复杂动机会在哪些中故事/集数里通过选择、代价、退让、反击、护短、背叛或醒悟体现出来。`
      : mode === 'literature'
        ? `\n【文学作品人物弧线硬要求】\n- 本次人物设定的核心目标是人物塑造、人物命运和主题承载，不是生成网文功能牌。\n- 主要人物必须有贯穿全书的成长、退化、妥协、醒悟、自我和解或精神破裂弧线；每条弧线都要写清初始困境、内在矛盾、现实压力、关键选择、不可逆后果和最终状态。\n- 重要配角也要有弧光：至少8-12个重要人物要写出他们如何受时代、家庭、职业、地域、阶层、亲密关系或旧事影响，并在故事中发生立场、情感或命运变化。\n- 对手、施压者和误解者也必须立得住：他们要有生活来源、利益逻辑、情感软肋、自我辩护和可能的悲剧性，不能写成单纯坏人。\n- 人物设定要能服务10个中故事的完整闭合：每个主要人物最好标明适合在哪几个中故事承担关键转折，最终命运必须能形成文学余韵。`
        : mode === 'film'
          ? `\n【电影剧本人物硬要求】\n- 本次人物设定必须服务一部90-120分钟电影长片，不要生成20-30个网文式功能角色。\n- 角色规模建议：主人公1人；B故事/情感或导师人物1-2人；主要对手/反派1-2人；关键配角4-8人；可点到为止的场景功能人物若干。总出场人物以电影可识别、可调度为准。\n- 主人公必须有清楚的外部目标、内在缺陷、错误信念、可视化行为习惯和终场蜕变；人物弧线要能对应《救猫咪》15节拍。\n- B故事人物必须能承载主题讨论，并在第三幕启发主人公解决问题。\n- 反派/压力源必须和主人公的欲望、缺陷或主题形成镜像关系，不能只是坏人。\n- 每个重要角色都要写出：首次出场方式、与主人公的关系、欲望、秘密、转折节拍、最终位置。`
        : `\n【人物弧线硬要求】\n- 主角必须有贯穿长线的成长弧线：初始缺陷、阶段选择、付出代价、能力/心态/关系变化、终局蜕变要连续可见。\n- 重要配角和主要对手也要有欲望、弱点、利益变化和选择后果，避免只作为工具人出现。\n- 至少6-10个重要人物要写出“初始立场 -> 触发事件 -> 中段变化 -> 后续作用/结局位置”。`;
    const characterGroupingRule = mode === 'microdrama'
      ? '除明确设置的「贯穿主线主反派/核心压力源」外，其他人物仍应依据世界观自然场域生成，不要机械套“主角团/主角阵营/反派阵营/正派/龙套”模板。'
      : mode === 'film'
        ? '角色应依据电影叙事功能与真实场域生成，不要按“主角团/阵营/势力”堆人；控制角色数量，优先保证每个重要角色有清晰银幕功能。'
        : '新增角色应依据世界观自然场域生成，不要按“主角团/主角阵营/反派阵营/正派/反派”模板分类。';
    const opponentNamingRule = mode === 'microdrama'
      ? '必须明确设置贯穿主线的主反派/核心压力源；其他对手、施压者、误解者和利益竞争者不要简单脸谱化。'
      : mode === 'film'
        ? '必须明确主人公、B故事人物、主要对手/压力源和关键配角；对手要有主题镜像和可表演的动机，不要简单脸谱化。'
        : '可以存在主要人物、对手、施压者、误解者和利益竞争者，但不要用“反派”“主角阵营”等字眼做类别，也不要把人物简单写成坏人。';

    if (dto.existingCharacters?.trim() && dto.note?.trim()) {
      const expansionPackOnly = dto.note.includes('[AUTO_EXPANSION_PACK_ONLY]');
      const cleanedNote = dto.note.replace('[AUTO_EXPANSION_PACK_ONLY]', '').trim();
      const supplementalPrompt = expansionPackOnly
        ? `你是一名长篇小说人物设定统筹。现在需要根据用户批注，在既有人物设定正文的基础上生成“新增人物扩展包”。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

既有人物设定正文（只作为一致性参考，不要复写）：
${dto.existingCharacters}

用户批注：
${cleanedNote}

请严格按以下要求输出：
1. 只输出「人物扩展包」，不要输出完整更新后的人物设定正文，不要复写既有人物设定。
2. 扩展包必须能直接追加在既有人物设定正文后方使用，角色编号、类别、出场阶段清晰。
3. 新增角色必须与故事大纲、世界观和既有人设一致，并能直接服务后续中故事/小故事生成。
4. 不要删除、改写、总结或压缩原有角色。
5. ${characterGroupingRule}
6. 不要出现“金手指、系统、外挂、能力成长、异能等级、修炼境界、神器绑定”等概念；重点写社会位置、资源、欲望、秘密、关系和行动逻辑。
7. 不要输出补丁说明、修改清单、执行过程或额外解释。
8. 新增角色必须补足人物弧线：重要新增角色要写出初始立场、关键转折、关系变化和后续结局位置；若是微短剧，要优先补足贯穿主线的反派/核心压力源及其代理人网络。
${characterArcModeBlock}
	${characterNameRestrictions}`
        : `你是一名长篇小说人物设定统筹。现在需要根据用户批注，在既有人物设定正文的基础上补充内容，并把新增内容插入到最合适的位置。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

既有人物设定正文：
${dto.existingCharacters}

用户批注：
${dto.note}

请严格按以下要求输出：
1. 输出“完整更新后的人物设定正文”，不要只输出新增角色、补丁说明或修改清单。
2. 保留原文已有角色、关系网、结构和写作口吻，只在需要的位置补充、扩写或微调衔接。
3. 根据批注把新增角色、关系、动机、当前状态或冲突线插入最合适的类别；如果原文没有合适位置，可以新增一个小节。
4. 不要删除与批注无关的角色，不要重写成另一套人物体系。
5. 新增内容必须与故事大纲、世界观和既有人设一致，并能直接服务后续中故事/小故事生成。
6. ${characterGroupingRule}不要出现“金手指、系统、外挂、能力成长、异能等级、修炼境界、神器绑定”等概念。
7. 新增或调整人物时，必须补足人物弧线：主角、重要配角、主要对手/压力源要写出初始立场、关键转折、关系变化、阶段作用和结局位置。
${characterArcModeBlock}
${characterNameRestrictions}`;

      try {
        const result = await this.chatWithSelectedLogicModel([
          { role: 'user', content: supplementalPrompt }
        ], dto);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error('补充人物设定失败:', error);
        if (error instanceof Error && error.message) {
          throw new Error(error.message);
        }
        throw new Error('AI补充人物设定失败，请稍后重试');
      }
    }

    const prompt = mode === 'film'
      ? `基于以下故事大纲和世界观基础设定，生成一套可直接支撑电影剧本创作的人物设定。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

请生成一套电影化角色表，角色数量控制在电影可承载范围内。

**重要限制条件：**
${characterNameLimitBlock}
${characterArcModeBlock}

**输出结构：**
【核心角色】
1. 主人公：姓名、年龄段、身份、外部目标、内在缺陷、错误信念、可视化行为习惯、开场状态、终场蜕变。
2. B故事人物：如何承载主题、与主人公的关系变化、在第三幕如何启发解决方案。
3. 主要对手/压力源：公开身份、真实欲望、与主人公的镜像关系、压迫手段、败局逻辑。
4. 关键配角：4-8人，每人写清银幕功能、首次出场方式、欲望/秘密、在哪些节拍推动转折。

【人物关系图】
- 用条目写清亲密关系、利益关系、旧怨、误解、交换、背叛、保护和牺牲可能。

【15节拍角色调度表】
- 按15个节拍列出哪些角色必须出场、每次出场带来什么行动或信息增量。

要求：
- 不要输出长篇网文式角色百科，不要堆角色。
- 每个重要角色都必须能被演员表演，能在场景中通过动作、台词和选择体现。
- 不要出现“金手指、系统、外挂、能力成长、异能等级、修炼境界、神器绑定”等概念。
- 只输出人物设定正文，不要寒暄。`
      : `基于以下故事大纲和世界观基础设定，生成一套可直接支撑长篇创作的人物群像。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

请依据世界观自身的家庭、职业、地域、阶层、机构、行业、圈层、历史旧账和利益关系，生成20-30个完整人物。${characterGroupingRule}

**重要限制条件：**
${characterNameLimitBlock}
${characterArcModeBlock}

**要求：**
- 输出开头必须先写「【核心人物与主线】」，且严格按以下顺序排列：1. 主角/主人公；2. 核心搭档或感情线核心人物；3. 与主角目标最相关的主要配角；4. 贯穿主线的主反派/核心压力源；5. 与主线强相关的其他人物。禁止把反派、压力源或幕后黑手放在主角前面。
- 「【核心人物与主线】」里的每个核心人物都要写出：本人的目标、阻力、行动方式、和主角的因果关系、人物弧线。主角必须写得最完整，供后续正文写作直接抓取。
- 只按“人物在世界观中的位置”组织，例如：家庭与亲缘、学校/单位/行业、地方社会、资本与资源、旧案/旧怨相关人、情感关系、边缘见证者、压力来源等；具体分组要根据世界观自然生成。
- 每个角色都要有：姓名、年龄段、身份/职业/社会位置、生活处境、外在行为习惯、内在欲望、恐惧或创伤、隐藏信息、与其他人物的真实关系、可能推动的事件。
- 每个主要人物和重要配角必须额外写「人物弧线」：初始状态/缺陷、被什么事件触发、会经历什么选择和代价、关系如何变化、最终可能走向哪里。不能只写静态人设。
- 不要把人物写成脸谱化功能牌。每个人都要有自利性、局限性、矛盾点、可变动的立场和能被剧情触发的行动逻辑。
- ${opponentNamingRule}
- 不要出现“金手指、系统、外挂、能力成长、异能等级、修炼境界、神器绑定”等概念；如果原故事大纲里有特殊机制，也只能转化为人物所面对的规则、资源、心理压力或现实代价。
- 所有人物都必须从世界观里长出来，能看出其所属场域、资源来源、关系网络和与主线冲突的连接方式。
- 人物之间必须形成交叉关系：亲缘、旧识、同事、师生、邻里、交易、竞争、欠债、秘密、误会、保护、亏欠等，避免孤立人物清单。
- 输出结尾必须追加「【人物弧线总表】」：列出主角、3-5个最重要配角、主要对手/核心压力源的长线变化，并标注适合承载他们转折的中故事阶段。
- **严格遵守上述限制条件**

请先输出「【核心人物与主线】」，再按世界观自然分组输出其他人物；不要用主角团、主角阵营、反派阵营这些标签。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('生成人物设定失败:', error);
      throw new Error('AI生成人物设定超时，请稍后重试');
    }
  }

	  async generateDetailedOutline(dto: GenerateDetailedOutlineDto) {
	    console.log('开始生成情节细纲，基于故事大纲自动选择中故事');
	    const mode = this.normalizeDetailedOutlineMode(dto.mode);
	    if (dto.outlineRevisionSuggestion?.trim() && dto.existingDetailedOutline?.trim()) {
	      if (dto.partialOutlineTargetIndexes?.length) {
	        return this.regenerateSelectedDetailedOutlineSegments(dto, mode);
	      }
	      return this.regenerateDetailedOutlineWithSuggestion(dto, mode);
	    }

	    if (mode === 'microdrama') {
      const { prompt, compactPrompt, safetyPrompt } = this.buildMicrodramaDetailedOutlinePrompts(dto);
      try {
        const result = await this.chatWithSelectedLogicModel([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: prompt }
        ], dto);

        return {
          success: true,
          data: this.cleanPublicOutlineMetadata(result),
        };
      } catch (error) {
        console.error('微短剧情节细纲主提示词失败，尝试精简重试:', error);
        try {
          const result = await this.chatWithSelectedLogicModel([
            { role: 'system', content: this.getStoryWritingSystemPrompt() },
            { role: 'user', content: compactPrompt }
          ], dto);

          return {
            success: true,
            data: this.cleanPublicOutlineMetadata(result),
          };
        } catch (compactError) {
          console.error('微短剧情节细纲精简提示词失败，尝试安全重试:', compactError);
          const result = await this.chatWithSelectedLogicModel([
            { role: 'system', content: this.getStoryWritingSystemPrompt() },
            { role: 'user', content: safetyPrompt }
          ], dto);

          return {
            success: true,
            data: this.cleanPublicOutlineMetadata(result),
          };
        }
	      }
	    }

	    if (mode === 'literature') {
	      return this.generateLiteratureDetailedOutline(dto);
	    }

	    if (mode === 'film') {
	      return this.generateFilmDetailedOutline(dto);
	    }

	    const existingDetailedOutline = dto.existingDetailedOutline?.trim() || '';
    const existingMacroStoryCount = this.countMacroStories(existingDetailedOutline);
    const existingLastMacroStoryNumber = this.getLastMacroStoryNumber(existingDetailedOutline);
    const startMacroStoryNumber = Math.max(
      1,
      dto.outlineStartNumber || (existingLastMacroStoryNumber > 0 ? existingLastMacroStoryNumber + 1 : existingMacroStoryCount + 1),
    );
    const inferredBatchIndex = Math.max(1, dto.outlineBatchIndex || Math.floor((startMacroStoryNumber - 1) / 10) + 1);
    const batchIndex = inferredBatchIndex;
    const endMacroStoryNumber = startMacroStoryNumber + 9;
    const isFinalBatch = dto.isFinalBatch === true;
    const previousContextBlock = existingDetailedOutline
      ? `\n已有中故事细纲（必须完整承接，不能重复已发生的核心事件）：\n${existingDetailedOutline}\n`
      : '\n已有中故事细纲：无。本次为第一批中故事，应承担开局建立与第一阶段推进。\n';
    const previousEndingBlock = existingDetailedOutline
      ? `\n上一批结尾锚点（本批第一个中故事必须从这里自然续写，承接主角状态、人物关系、当前压力和下一阶段目标）：\n${this.extractEndingForContinuity(existingDetailedOutline)}\n`
      : '';
    const batchStageInstruction = isFinalBatch
      ? `这是用户手动选择的大结局批次：必须承接前${existingMacroStoryCount || startMacroStoryNumber - 1}个中故事，把主线矛盾、爱情线/事业线、人物命运和核心伏笔推向高潮并完成结尾收束。`
      : batchIndex === 1
        ? '这是第1批：必须建立开局吸引力、核心矛盾、主角初始成长路径和主要人物关系，但不要写成全书结尾。'
        : `这是第${batchIndex}批续写：必须在完整引用世界观、人设的基础上，继续承接前${existingMacroStoryCount || startMacroStoryNumber - 1}个中故事的因果、伏笔、人物状态与关系变化，向下一阶段推进。本批不是大结局批次，严禁进入最终决战、最终真相揭晓、终极反派落败、主线完全收束或人物命运终局，只能形成阶段性胜负、阶段性卡点、下一阶段目标或更大的压力。`;
    const reviewRiskInstruction = dto.reduceSensitiveContent
      ? '\n**审核风险控制（用户已开启，必须优先执行）：** 降低血腥、酷刑、虐杀、露骨伤害、极端暴力、违法教学、敏感身份冲突等容易卡审核的桥段；保持强冲突和爽点，但改用关系压迫、利益夺取、证据反转、公开羞辱、限时危机、权力博弈、身份错位、舆论误会、契约代价、资源封锁、背叛曝光等可发布表达。\n'
      : '';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();

    const prompt = `基于以下故事大纲、世界观基础设定、人物设定和已有中故事进度，为200万字长篇小说生成阶段性情节细纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

${previousContextBlock}
${previousEndingBlock}
${reviewRiskInstruction}

**本次生成批次（必须遵守）：**
1. 长篇小说可以按多批中故事连续续写；每次只生成 10 个新的中故事，是否进入终局只由用户的“大结局批次”选择决定。
2. 本次是第 ${batchIndex} 批，只输出【中故事${this.getChineseNumber(startMacroStoryNumber)}】到【中故事${this.getChineseNumber(endMacroStoryNumber)}】，不能多、不能少。
3. ${batchStageInstruction}
4. 每一批都必须完整引用世界观和人设；第2批及之后还必须把已有中故事作为前文事实，严格保持人物状态、关系、压力、目标和伏笔的连续性。
5. 这 10 个中故事只是当前阶段，不代表用户必须先生成完 40 个中故事；用户生成任意一个中故事后，也可以进入下一步继续细化小故事。

**一、故事线整体结构（必须遵守）：**
本小说以故事线为主。一般情况下采用以下两种结构之一：
- **方案A：两条事业线 + 一条爱情线**
- **方案B：两条爱情线 + 一条事业线**

在生成的中故事中，要明确每条事业线/爱情线分别由哪些中故事承载；事业线中故事遵循下方「事业线一级结构」与「事业线节点类型」，爱情线相关中故事严格遵循「爱情线写作技法」与「爱情线一级结构」。这些结构只作为内部设计依据，最终输出的大纲不要暴露成字段标签。

**二、爱情线写作技法（爱情线相关中故事必须遵循）：**
${romanceLineRules}

爱情线的节点层级几乎固定，上限低、保下限。基本逻辑为：**好感度 → 两人关系所处阶段 → 爱情线阶段**。

**2.1 概念定义：**
- **好感度**：负好感度、零好感度、半好感度、满好感度
- **两人关系所处阶段**：熟悉阶段、试探阶段、暧昧阶段、确认关系阶段
- **爱情线阶段**：萍水相逢阶段、爱情喜剧阶段、爱隔山海阶段、大结局阶段

**2.2 好感度与两人关系阶段的对应：**
- 负好感度、零好感度 → 熟悉阶段
- 半好感度 → 试探阶段 或 暧昧阶段
- 满好感度 → 确认关系阶段

**2.3 爱情线四阶段与节点要求：**

（1）**萍水相逢阶段**
- 必有节点：人物登场；主角或读者熟悉可攻略对象。
- 可选节点：
  - 展示可攻略对象人设：外观形象、性格、他人对其的评价；可进一步展示性格以外的行为模式、形成其行为模式的经历、部分人际关系。
  - 角色提升或试图提升对方好感度的节点（攻略行为）。

（2）**爱情喜剧阶段**
- 前提：从熟悉阶段或试探阶段进入暧昧阶段（进入暧昧阶段为必有节点）。若两人出场时已在暧昧阶段以上，则本阶段可省略。
- 可选节点（多出现在试探阶段）：
  - 试探对方态度（可搭配争风吃醋、刻意让对方吃醋以验证态度）；
  - 好感度变化结构：设计考验或试探，通过对方是否通过考验/是否做出特定反应来确认心意，并提升好感度；
  - 确定自己感情；
  - 半好感度以上时：有分寸地试探对方能否接受 CP 行为；
  - 半好感度以上时：向对方表达爱意（示爱结果：满好感→直接确认关系；半好感→好感提升但可能犹豫；失败→因好感不足被拒则好感一般下降，因其他原因被拒则好感一般上升）；
  - 半好感度以上时：关爱对方、发狗粮（CP 行为或一方接受对方特殊对待后触动/感动、好感大增）；
  - 两人关系不能顺利进入下一阶段的阻碍。

（3）**爱隔山海阶段**
- 必有节点：从暧昧阶段进入确认关系阶段（两人处于暧昧阶段为前提）。
- 可选节点：两人关系不能顺利进入下一阶段的阻碍（如不能确认为情侣/夫妻或告知他人），或现有关系/相处状态遭遇破坏性改变的危机；此时关系一般为准爱情关系。

（4）**大结局阶段**
- 前提：两人已处于确认关系阶段；大结局为固定节点。
- 可选节点：两人关系或相处状态遭遇破坏性改变的危机；或两人状态发生变化导致关系发生新变化的节点；此时关系一般为爱情关系甚至婚姻关系。

注：后阶段可调用前阶段的节点逻辑。设计可攻略角色时，可参考下方人物价值取向种类。

**2.4 常见人物价值取向种类（供人设与爱情线动机参考）：**
(1)善人 (2)认可人 (3)慕强者 (4)谋利者 (5)守护者 (6)关系人 (7)艺术家 (8)享乐者 (9)逃避者 (10)求知者 (11)模仿者 (12)无追求者

**2.5 爱情线一级结构（余韵，爱情线中故事可选采用）：**
好感度变化结构、受益结构、争风吃醋结构、发展受阻结构、关系危机结构、装逼结构、狗粮结构。

**三、事业线结构与节点（事业线中故事必须参照）：**

**3.1 事业线一级结构：**
阻碍结构、危机结构、装逼结构、探明结构、取得结构、义举结构。每个事业线中故事应明确采用哪一种或哪几种一级结构。

**3.2 事业线节点类型（层级相对自由，可自行设计多层级）：**
(1) 主要角色的目标出现以及为了实现目标而进行的每一步行动
(2) 主要角色里程碑式的状态（等级、职务等）
(3) 地图的更新
(4) 主要角色所处的利益团体的发展或者更换
(5)「神器」或「宝物」的取得及其发展
(6) 主要角色的登场和退场（除功能性配角和跑龙套以外的角色）
(7) 特定角色之间关系的发展
(8) 新矛盾源、矛盾、冲突的出现和矛盾冲突的升级以及矛盾、矛盾源的消解
(9) 戏剧性的出现或者升级
(10) 主角或者读者的预期被打破带来的剧情确定性忽然下降
(11) 大故事或中故事中其他里程碑式的情节或关键情节

**四、中故事的目的、叙事方法与内部结构：**

每个中故事需明确：**要达成的目的**、**采用的叙事技法（技法卡）**、**内部一级结构**。

**4.1 技法卡（叙事方法——主角被置于什么环境、或主角对事件推动起什么作用）：**
(1)舞台聚光灯 (2)打破预期 (3)信息差 (4)拟感成真 (5)戏剧三角 (6)过激行为 (7)翻弄风云 (8)望远镜 (9)新视角 (10)反差 (11)落差 (12)双刃剑 (13)差异

设计每个中故事时，可选用上述一种或多种技法卡，让主角在环境与推动事件上的角色清晰可辨。

**4.2 内部结构对应关系：**
- **事业线中故事**：内部结构从「事业线一级结构」中选取（阻碍/危机/装逼/探明/取得/义举），节点设计参考「事业线节点类型」。
- **爱情线中故事**：内部结构从「爱情线一级结构」中选取（好感度变化/受益/争风吃醋/发展受阻/关系危机/装逼/狗粮），并遵循「爱情线四阶段与节点要求」。

**五、中故事类型池（本次从中选择 10 个）：**

**起源与成长类（4种）：** 问道初庭、潜龙初现、星火复燃、破茧之变

**情感与人性类（9种）：** 情愫暗生、旧恨新谋、古道热肠、万民福祉、误中情网、假面舞会、背刺之痛、蜜语争端、和解之桥

**探索与奥秘类（8种）：** 迷雾揭晓、尘封秘闻、诡局落子、绝地寻生、异域探幽、界域穿行、未来残影、禁忌之门

**冲突与考验类（10种）：** 怀璧之劫、风云擂台、巨鳄相争、盛会风云、生死赌局、智取豪夺、如影随形、暗流行动、异化之躯、不公之刃

**转折与蜕变类（14种）：** 三寸惊雷、失控漩涡、刮目之时、缚能之刻、踪迹成谜、两界纽带、契约束缚、外敌叩关、破枷之行、无中生有、命运交易、微澜访世、悠然时光、养成篇章

**六、生成要求：**
1. 先确定采用「两条事业线+一条爱情线」或「两条爱情线+一条事业线」，并在细纲开头用一两句话说明三条线分别是什么。
2. 本次只自动选择 10 个最匹配的中故事类型，合理分配到各条事业线/爱情线；这 10 个只对应当前批次，不代表全书全部中故事。
3. **每个中故事必须标明：**
   - **目的**：该中故事要达成的具体目的；
   - **技法卡**：采用的叙事技法（从 13 种技法卡中选用，如舞台聚光灯、打破预期、信息差等），即主角被置于什么环境、或对事件推动起什么作用；
   - **一级结构**：事业线中故事标明所用事业线一级结构（阻碍/危机/装逼/探明/取得/义举）；爱情线中故事标明所用爱情线一级结构（好感度变化/受益/争风吃醋/发展受阻/关系危机/装逼/狗粮）。
4. **涉及主角与一位或多位配角之间爱情的中故事**，必须在内部按当前爱情线阶段控制好感变化、两人关系推进和必有节点，但不要把“好感度/两人关系阶段/爱情线阶段/桥段类型/爱情线一级结构”写成字段；只能在「详细剧情」中通过具体互动、误会、试探、救场、吃醋、甜宠、并肩破局等剧情体现。
5. 事业线中故事的节点设计可参照「事业线节点类型」的 11 类，合理选用目标与行动、里程碑状态、地图更新、利益团体、神器宝物、角色登场退场、关系发展、矛盾出现与升级、戏剧性、预期打破、里程碑情节等。
6. 每个中故事必须能支撑 15 章以上的详细内容，含丰富情节、支线与深度发展；自动拆分时会拆成15个单章小故事。
7. ${batchIndex === 1
      ? '【中故事一】必须以“生死为局”开头，是决定开局生死成败的核心中故事：主角一入场就面对不可回避的生死存亡、命运毁灭、身份崩塌或重大失败，必须足够精彩、不能拖沓；但开局不能是匿名危机，必须在危机推进中简短带出主角身份、所处时代/世界空间、当前阶层/家庭/职业处境和最关键世界规则，让读者明白“这个人是谁、为什么会被逼到这里”。对应的前15章必须严格包含三段连续升级的故事段落：第1-3章完成第一段，第4-9章完成第二段，第10-15章完成第三段。三段必须连续升级、持续爆点、快速推进。'
      : `本批第一个中故事【中故事${this.getChineseNumber(startMacroStoryNumber)}】必须承接上一批结尾的阶段状态、关系变化、压力和目标，不要重新开局，也不要推翻前文事实。`}
8. 除第一个中故事外，之后每一个中故事都必须以重大危局开头：新的强敌压境、旧账爆雷、关系撕裂、资源被夺、身份暴露、任务失败、势力围剿或目标突然升级，不能平铺过渡。
9. 每个中故事都要让新颖且富有戏剧张力的情节层出不穷：信息差、预期打破、反转打脸、高燃对抗、情感爆雷、奇谋破局等爽点必须直达阶段高潮。
10. 按小说时间顺序排列中故事，保证整体节奏紧凑，情节连贯、人物有成长弧线。
11. 每个中故事的前置信息必须短：目的、技法卡、一级结构、承载主线、节点等只用关键词或1句话，不要长篇解释。
12. 每个中故事的主体篇幅必须放在「详细剧情」，至少占该中故事总字数的70%；必须写清开端、发展、高潮、转折、结局，不能被前置信息挤占。
13. 避免简单套路，中故事需有复杂冲突、多层矛盾与主题探讨。
14. 每个中故事结尾必须追加「阶段状态小结」，写清：主角当前状态、主角和主要人物的关系、主角目前受到的压力、主角下一阶段目标方向；并必须额外留下可推进下一中故事的扣子。
15. 本次只生成第 ${batchIndex} 批 10 个中故事。自动化写作入口会先取前5个中故事，每个中故事拆成15章，共75章。${isFinalBatch ? '本批必须完成全书终局、主线收束和人物关系落点。' : '本批结尾必须留下可继续生成下一批的推进空间，只能阶段性卡点，不能写成全书大结局。'}
16. **格式要求：** 每个中故事用明确标题标记，必须从【中故事${this.getChineseNumber(startMacroStoryNumber)}】开始，到【中故事${this.getChineseNumber(endMacroStoryNumber)}】结束，格式如下：
    【中故事${this.getChineseNumber(startMacroStoryNumber)}】具体的标题内容
    【中故事${this.getChineseNumber(startMacroStoryNumber + 1)}】具体的标题内容
    以此类推。标题后直接跟情节描述，中间不要空行。
17. **示例格式**：
    【中故事${this.getChineseNumber(startMacroStoryNumber)}】问道初庭
    目的：……。技法卡：舞台聚光灯、打破预期。一级结构：取得结构。节点：……。
    详细剧情：至少占本中故事70%篇幅，按关键章节段落展开：开局危机、连续升级、高燃爽点、阶段高潮、结尾扣子；若涉及爱情线，只写具体互动、误会、拉扯、救场和关系变化，不要写后台字段...
    阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

    【中故事${this.getChineseNumber(startMacroStoryNumber + 1)}】潜龙初现
    目的：……。技法卡：……。一级结构：……。
    详细剧情：至少占本中故事70%篇幅，写清危局开场、事件递进、反转打脸、高潮和结尾扣子...
    阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

请直接输出本批次的 10 个中故事细纲，不要先列出中故事名称列表。每个中故事的「详细剧情」必须详细具体，可作为 15 章内容的框架基础；前置信息只作短标注，事业线/爱情线信息要服务剧情，不要喧宾夺主。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: this.cleanPublicOutlineMetadata(result),
      };
	    } catch (error) {
	      console.error('生成情节细纲失败:', error);
	      throw new Error('AI生成情节细纲超时，请稍后重试');
	    }
	  }

	  private async regenerateSelectedDetailedOutlineSegments(dto: GenerateDetailedOutlineDto, mode: 'novel' | 'microdrama' | 'literature' | 'film') {
	    const existingDetailedOutline = dto.existingDetailedOutline?.trim() || '';
	    const suggestion = dto.outlineRevisionSuggestion?.trim() || '按三密度滑块迭代思路强化选中的中故事：提高情绪密度、桥段密度、要素融合度，补足人物弧线、冲突升级、阶段高潮和结尾钩子。';
	    const targets = [...new Set((dto.partialOutlineTargetIndexes || [])
	      .map(value => Number(value))
	      .filter(value => Number.isFinite(value) && value >= 0))]
	      .sort((a, b) => a - b)
	      .slice(0, 5);

	    if (targets.length === 0) {
	      throw new Error('未选择需要局部细化的中故事');
	    }

	    const macroStories = mode === 'film'
	      ? this.extractFilmBeatSegments(existingDetailedOutline)
	      : this.extractMacroStorySegments(existingDetailedOutline);
	    const targetBlock = targets
	      .map(index => mode === 'film'
	        ? `【第${this.getChineseNumber(index + 1)}节拍】\n${macroStories[index] || '未解析到内容，请按当前位置重新细化。'}`
	        : `【中故事${this.getChineseNumber(index + 1)}】\n${macroStories[index] || '未解析到内容，请按当前位置重新细化。'}`)
	      .join('\n\n');
	    const previousBoundary = targets[0] > 0
	      ? `【上一个${mode === 'film' ? '节拍' : '中故事'}边界】\n${macroStories[targets[0] - 1] || '无'}\n`
	      : `【上一个${mode === 'film' ? '节拍' : '中故事'}边界】无，当前包含开局${mode === 'film' ? '节拍' : '中故事'}。\n`;
	    const nextBoundary = targets[targets.length - 1] + 1 < macroStories.length
	      ? `【下一个${mode === 'film' ? '节拍' : '中故事'}边界】\n${macroStories[targets[targets.length - 1] + 1] || '无'}\n`
	      : `【下一个${mode === 'film' ? '节拍' : '中故事'}边界】无，当前选区靠近已有细纲末尾。\n`;
	    const modeRule = mode === 'microdrama'
	      ? `这是微短剧大纲，必须保持原有集数范围、卡点密度和可拍容量；每集只承载约1分钟剧情，不要写厚到2-3分钟。`
	      : mode === 'literature'
	        ? '这是文学作品细纲，必须降低网文味，强化人物处境、现实细节、心理变化和主题余韵。'
	        : mode === 'film'
	          ? '这是电影15节拍大纲，必须保持救猫咪节拍编号、节拍功能、电影场景规划和人物弧线，不要改回网文中故事。'
	        : '这是网文中故事细纲，必须让被选中中故事仍能继续拆成单章小故事。';
	    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
	    const reviewRiskRule = dto.reduceSensitiveContent
	      ? '\n审核风险控制已开启：降低血腥、酷刑、虐杀、露骨伤害、极端暴力、违法教学、敏感身份冲突等容易卡审核的桥段，用关系压迫、利益夺取、证据反转、公开羞辱、限时危机、身份错位、资源封锁、背叛曝光等可发布表达替代。\n'
	      : '';

	    const filmCardBlock = mode === 'film'
	      ? `\n【电影故事卡片库】\n${this.getFilmStoryCardPoolPrompt()}\n\n${this.getFilmStoryCardRulesPrompt()}\n`
	      : '';
	    const prompt = `请只针对用户选中的${mode === 'film' ? '节拍' : '中故事'}做“局部细化重写”，不要重写未选中的${mode === 'film' ? '节拍' : '中故事'}。

【故事大纲】
${dto.outline}

【世界观基础设定】
${dto.worldSetting}

【人物设定】
${dto.characters}

${previousBoundary}
【用户选中的${mode === 'film' ? '节拍' : '中故事'}原文】
${targetBlock}

${nextBoundary}
【用户局部细化要求】
${suggestion}

【模式规则】
${modeRule}

【感情线硬规则】
${romanceLineRules}
${filmCardBlock}
${reviewRiskRule}

重写要求：
1. 只输出用户选中的这些${mode === 'film' ? '节拍' : '中故事'}，编号必须保持原编号，例如${mode === 'film' ? '【第三节拍】、【第四节拍】' : '【中故事三】、【中故事四】'}；禁止输出未选中的${mode === 'film' ? '节拍' : '中故事'}，禁止追加新${mode === 'film' ? '节拍' : '中故事'}。
2. 每个被选中的${mode === 'film' ? '节拍' : '中故事'}都要比原版更具体、更可执行，${mode === 'film' ? '核心剧情' : '详细剧情'}必须占70%以上，不能压缩成摘要。
3. 必须承接上一个${mode === 'film' ? '节拍' : '中故事'}的结尾状态、人物关系、当前压力和目标方向；如果下一个${mode === 'film' ? '节拍' : '中故事'}存在，结尾必须自然对齐它的开局前提，不能提前消耗它的核心爆点。
4. 按三密度校准：情绪密度更高，桥段密度更高，要素融合更自然；用具体动作、代价、选择、反转和关系变化推进，不能只写概念。
5. ${mode === 'film' ? '必须保留或补上「故事卡调用」字段；每个被选中节拍从对应卡组选择2-4张卡，并把卡片转化为具体场景链。' : '保留「阶段状态小结」，写清：主角当前状态、主要人物关系、当前压力、目标方向。'}
6. 配角和反派不能工具人化，重要角色必须有欲望、弱点、利益关系和能推动剧情的行动逻辑。

输出格式：
${targets.map(index => mode === 'film'
  ? `【第${this.getChineseNumber(index + 1)}节拍】标题\n节拍功能：……\n人物调度：……\n场景规划：……\n故事卡调用：……\n市场化看点：……\n核心剧情：……\n主题推进：……\n节拍钩子：……`
  : `【中故事${this.getChineseNumber(index + 1)}】标题\n详细剧情：……\n阶段状态小结：……`).join('\n\n')}

请直接输出局部细化后的${mode === 'film' ? '节拍' : '中故事'}正文，不要输出说明、差异对比或完整大纲。`;

	    try {
	      const result = await this.chatWithSelectedLogicModel([
	        { role: 'system', content: this.getStoryWritingSystemPrompt() },
	        { role: 'user', content: prompt },
	      ], dto);

	      return {
	        success: true,
	        data: this.cleanPublicOutlineMetadata(result),
	      };
	    } catch (error) {
	      console.error('局部细化中故事失败:', error);
	      throw new Error('AI局部细化中故事失败，请稍后重试');
	    }
	  }

	  private async generateLiteratureDetailedOutline(dto: GenerateDetailedOutlineDto) {
	    const typePool = this.getMicrodramaTypePoolPrompt();
	    const prompt = `基于以下故事大纲、世界观基础设定和人物设定，为一部“文学作品”生成完整情节细纲。

【故事大纲】
${dto.outline}

【世界观基础设定】
${dto.worldSetting}

【人物设定】
${dto.characters}

【可借鉴的中故事类型池】
${typePool}

文学作品细纲要求：
1. 只生成 10 个中故事，从【中故事一】到【中故事十】。这 10 个中故事就是整部作品的完整结构，不是第一批，也不是阶段性生成；【中故事十】必须完成全书终点、人物命运落点、主题回声和核心矛盾收束。
2. 可以从上面的中故事类型池里选择合适的结构灵感，但不要输出“类型来源/技法卡/一级结构/爽点机制”等后台字段，也不要写成网文套路说明。
3. 整体要明显降低网文味：不要系统、金手指、外挂、升级流、修炼境界、神器宝物、连续打脸、强行装逼、无脑爽点、套路化反派压迫。
4. 采用传统文学/出版文学的气质：重视人物处境、关系变形、时代压力、生活细节、心理裂缝、命运选择、人性复杂和主题余韵。
5. 情节仍然要好看，但冲突来自现实规则、人物欲望、秘密、误解、亏欠、阶层差异、家庭结构、旧案旧怨、社会环境和个人选择，而不是靠外部外挂解决。
6. 每个中故事都要有清晰的叙事功能：开启、牵引、加压、转折、真相逼近、关系破裂、选择代价、命运反噬、临界时刻、终局回声。十个中故事之间必须形成完整的起承转合。
7. 每个中故事的「详细剧情」是主体，写成可继续扩展成章节的文学性梗概：必须包含关键场景、人物行动、关系变化、情绪暗流、现实细节、阶段性后果。
8. 每个中故事结尾保留「阶段状态小结」，但语气要克制，写清：人物当前处境、主要关系变化、未解压力、下一阶段牵引。最后一个中故事的状态小结必须写“作品终点”。
9. 不要出现【中故事十一】或任何“后续可继续生成”的说法；不要把第十个中故事写成继续连载的钩子。

格式要求：
【中故事一】具体标题
详细剧情：……
阶段状态小结：人物当前处境：……；主要关系变化：……；未解压力：……；下一阶段牵引：……。

【中故事二】具体标题
详细剧情：……
阶段状态小结：……

以此类推，严格到【中故事十】结束。请直接输出完整文学作品细纲。`;

	    try {
	      const result = await this.chatWithSelectedLogicModel([
	        { role: 'system', content: this.getStoryWritingSystemPrompt() },
	        { role: 'user', content: prompt },
	      ], dto);

	      return {
	        success: true,
	        data: this.cleanPublicOutlineMetadata(result),
	      };
	    } catch (error) {
	      console.error('生成文学作品细纲失败:', error);
	      throw new Error('AI生成文学作品细纲失败，请稍后重试');
	    }
	  }

	  private async generateFilmDetailedOutline(dto: GenerateDetailedOutlineDto) {
	    const filmStoryCardPool = this.getFilmStoryCardPoolPrompt();
	    const filmStoryCardRules = this.getFilmStoryCardRulesPrompt();
	    const beatTable = [
	      ['一', '开场画面', 'Opening Image', '第1分钟'],
	      ['二', '主题陈述', 'Theme Stated', '第5分钟'],
	      ['三', '铺垫', 'Set-up', '第1-10分钟'],
	      ['四', '催化剂', 'Catalyst', '第12分钟'],
	      ['五', '争论', 'Debate', '第12-25分钟'],
	      ['六', '进入第二幕', 'Break into Two', '第25分钟'],
	      ['七', 'B故事', 'B Story', '第30分钟'],
	      ['八', '娱乐和游戏', 'Fun and Games', '第30-55分钟'],
	      ['九', '中点', 'Midpoint', '第55分钟'],
	      ['十', '坏人逼近', 'Bad Guys Close In', '第55-75分钟'],
	      ['十一', '失去一切', 'All Is Lost', '第75分钟'],
	      ['十二', '灵魂黑夜', 'Dark Night of the Soul', '第75-85分钟'],
	      ['十三', '进入第三幕', 'Break into Three', '第85分钟'],
	      ['十四', '大结局', 'Finale', '第85-110分钟'],
	      ['十五', '终场画面', 'Final Image', '第110分钟'],
	    ];
	    const beatLines = beatTable
	      .map(([index, name, english, timing]) => `【第${index}节拍】${name}（${english}，${timing}）`)
	      .join('\n');

	    const prompt = `基于以下故事大纲、电影化世界观和人物设定，为一部90-120分钟中文电影长片生成《救猫咪》15节拍大纲。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

电影故事卡片库（必须按节拍调用）：
${filmStoryCardPool}

${filmStoryCardRules}

硬性目标：
1. 必须使用《救猫咪》15个故事节拍作为骨架，不能写成网文“中故事”，也不要输出“中故事”三个字。
2. 每个节拍就是后续写作的一次正文单位，后续会把每个节拍拆成若干场景，再把该节拍下所有场景整合成3000-4000字电影剧本。
3. 整体应能形成约25,000-35,000字中文电影剧本；喜剧/剧情/悬疑可略密，动作/惊悚可略少。
4. 全片场景切换目标为80-120场。请在每个节拍里规划建议场数，使总场数落在这个区间；大结局可最多，开场/主题/终场最少。
5. 人物数量必须符合电影承载力：核心角色3-5人，重要配角4-8人；不要像剧集或网文一样堆角色。
6. 大纲必须电影化：每个节拍写清外部行动、人物选择、场景方向、视觉/声音意象、冲突升级和主题推进。
7. 大纲必须市场化：先判断故事最适合的商业类型和目标观众，再把已有题材元素推到最吸引人的方向。悬疑要有谜题、误导、反转和真相代价；犯罪要有道德困局、证据压力和追捕/交易；爱情要有高概念关系困境、误会升级和选择代价；喜剧要有持续错位、人物欲望和场面升级；动作/灾难要有明确倒计时、空间危机和高压行动；现实题材也要有强情境、强人物欲望和强社会压力。
8. 每个节拍都必须有“可营销的看点”：高概念钩子、类型片场面、关系爆点、身份揭露、限时任务、强反转、情感崩塌、道德选择或视觉奇观。不能只是平铺剧情功能。
9. 核心剧情必须丰富到足以支撑后续3000-4000字节拍剧本；每个节拍至少包含3-6个连续事件或场景动作，大结局至少包含8-12个连续动作节点。不要只写一句“主角受挫/反派逼近/关系变化”。
10. 每个节拍必须调用本节拍对应的电影故事卡片：在“故事卡调用”字段列出2-4张卡，并在“核心剧情”里把这些卡变成具体场景链和人物选择。

固定节拍标题，必须逐项输出，不能缺、不能多、不能改编号：
${beatLines}

生成前先在内部完成商业化强化，但不要单独输出分析过程：
- 提炼本片“一句话卖点”：观众为什么会点开/买票。
- 提炼本片三类核心看点：类型刺激、人物关系、情感/主题代价。
- 检查15个节拍是否每一段都有强事件、强选择、强关系变化或强视觉动作；平淡节拍必须重写得更有戏。
- 检查核心剧情是否能直接拆成场景，不能只是抽象说明。
- 检查每个节拍是否都从对应故事卡组中选择了最能放大本片题材卖点的2-4张卡，并把卡片转译成剧情动作。

每个节拍按以下格式输出：
【第X节拍】中文节拍名（英文名，预计时间点）
节拍功能：1句话说明这个节拍在本片里的叙事功能
人物调度：列出必须出场的角色，以及本节拍中角色关系/立场的变化
场景规划：建议X场；写出主要场景类型、地点和场景切换逻辑
故事卡调用：只列本节拍对应卡组中选择的2-4张卡片名，并用一句话说明它们如何组合成剧情发动机
市场化看点：列出本节拍最吸引观众的2-4个类型看点或情感爆点
核心剧情：700-1200字，写清具体发生什么，主人公要什么、遇到什么阻力、采取什么连续行动、每个场景如何升级、出现什么关系爆点/类型场面/反转、结果是什么；必须写成能直接拆场的剧情链
主题推进：1句话，说明这个节拍如何推进主题命题或主人公内在缺陷
节拍钩子：1句话，说明如何把观众推向下一节拍

额外要求：
- 开场画面与终场画面必须形成清晰视觉对照。
- 主题陈述必须是一句可被角色说出口的话，不要写成抽象论文句。
- 中点必须明确是“伪胜利”或“伪失败”，并提高赌注。
- 失去一切要有“伪死亡”时刻；灵魂黑夜要让主人公真正理解主题。
- 进入第三幕必须受到B故事启发。
- 大结局要按电影高潮处理，写出场景推进和行动解决方案，不要只写总结。
- 如果某个节拍天然偏静，例如主题陈述、争论、灵魂黑夜，也必须通过具体冲突场景、人物动作、关系压力、沉默选择、失败后果或反常行为写出戏剧性。
- 不要输出创作说明、分析过程或寒暄。`;

	    try {
	      const result = await this.chatWithSelectedLogicModel([
	        { role: 'system', content: this.getStoryWritingSystemPrompt() },
	        { role: 'user', content: prompt },
	      ], dto);

	      return {
	        success: true,
	        data: this.cleanPublicOutlineMetadata(result),
	      };
	    } catch (error) {
	      console.error('电影15节拍大纲生成失败:', error);
	      throw new Error('AI生成电影15节拍大纲失败，请稍后重试');
	    }
	  }

	  private async regenerateDetailedOutlineWithSuggestion(dto: GenerateDetailedOutlineDto, mode: 'novel' | 'microdrama' | 'literature' | 'film') {
	    const existingDetailedOutline = dto.existingDetailedOutline?.trim() || '';
	    const suggestion = dto.outlineRevisionSuggestion?.trim() || '';
	    const existingCount = this.countMacroStories(existingDetailedOutline);
	    const episodeCount = this.normalizeMicrodramaEpisodeCount(dto.microdramaEpisodeCount);
	    const modeRule = mode === 'microdrama'
	      ? `这是微短剧大纲，必须保持微短剧结构、全剧 ${episodeCount} 集、现有中故事数量和集数分配，不要改成网文章回。`
	      : mode === 'literature'
	        ? `这是文学作品细纲，必须保持传统文学/出版文学气质，降低网文味；全书严格以10个中故事为完整终点，不得追加第11个中故事，不得写成后续连载钩子。`
	        : mode === 'film'
	          ? `这是电影剧本模式，必须保持《救猫咪》15节拍结构，重写后仍使用【第一节拍】到【第十五节拍】，不能输出中故事。`
	        : `这是网文中故事细纲，必须保持中故事编号连续；若当前已有 ${existingCount || '若干'} 个中故事，重写后也应保留相同数量，不要擅自追加下一批。`;
    const reviewRiskRule = dto.reduceSensitiveContent
      ? `\n审核风险控制已开启：降低血腥、酷刑、虐杀、露骨伤害、极端暴力、违法教学、敏感身份冲突等容易卡审核的桥段；用关系压迫、利益夺取、证据反转、公开羞辱、限时危机、身份错位、舆论误会、资源封锁、背叛曝光等可发布表达替代。\n`
      : '';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();

    if (mode === 'film') {
      const filmStoryCardPool = this.getFilmStoryCardPoolPrompt();
      const filmStoryCardRules = this.getFilmStoryCardRulesPrompt();
      const filmPrompt = `请根据用户导入的修改建议，对当前已有电影情节细纲进行“完整重生成”。

【故事大纲】
${dto.outline}

【世界观基础设定】
${dto.worldSetting}

【人物设定】
${dto.characters}

【当前已有电影15节拍大纲，必须作为基底】
${existingDetailedOutline}

【用户导入的修改建议，必须显著执行】
${suggestion}

【电影故事卡片库】
${filmStoryCardPool}

${filmStoryCardRules}
${reviewRiskRule}

重生成要求：
1. 必须保持《救猫咪》15节拍结构，重写后仍使用【第一节拍】到【第十五节拍】，不能输出“中故事”三个字。
2. 先输出「【电影商业维度复盘】」，用0-100分给出改后版本的：类型卖点、节拍强度、人物弧光、场景可拍性、关系张力、反转密度、主题清晰度、市场潜力；每项只写“分数 + 一句判断”。然后输出「【新版电影15节拍大纲】」和完整新版大纲。
3. 每个节拍必须从对应的电影故事卡组中选择2-4张，写入“故事卡调用”字段，并把这些卡片转化为核心剧情中的具体事件、人物动作、关系压力、信息揭露或类型片场面。
4. 每个节拍都要保留并强化：节拍功能、人物调度、场景规划、故事卡调用、市场化看点、核心剧情、主题推进、节拍钩子。
5. 核心剧情不能越写越短：新版每个节拍的“核心剧情”信息量、关键事件数、场景推进层次不得少于原版；每个节拍至少包含3-6个连续事件或场景动作，大结局至少8-12个连续动作节点。
6. 静态节拍也必须写出戏剧性：主题陈述、争论、灵魂黑夜、终场画面都要通过具体冲突场景、人物动作、关系压力、沉默选择、失败后果或反常行为展开。
7. 保持电影承载力：核心角色3-5人，重要配角4-8人；不要扩成剧集或网文支线。
8. 每个节拍都要能继续拆成场景细纲，并最终支撑约3000-4000字电影剧本正文。

每个节拍格式：
【第X节拍】中文节拍名（英文名，预计时间点）
节拍功能：……
人物调度：……
场景规划：……
故事卡调用：……
市场化看点：……
核心剧情：……
主题推进：……
节拍钩子：……

请直接输出完整新版电影15节拍大纲，不要输出差异对比或补丁。`;

      try {
        const result = await this.chatWithSelectedLogicModel([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: filmPrompt }
        ], dto);

        return {
          success: true,
          data: this.cleanPublicOutlineMetadata(result),
        };
      } catch (error) {
        console.error('根据建议重生成电影15节拍失败:', error);
        throw new Error('AI根据建议重生成电影15节拍失败，请稍后重试');
      }
    }

    const prompt = `请根据用户导入的修改建议，对当前已有情节细纲进行“完整重生成”。

【故事大纲】
${dto.outline}

【世界观基础设定】
${dto.worldSetting}

【人物设定】
${dto.characters}

【当前已有情节细纲，必须作为基底】
${existingDetailedOutline}

【用户导入的修改建议，必须显著执行】
${suggestion}

【本次重写必须额外执行的感情线硬规则】
${romanceLineRules}

重生成要求：
1. 先输出「【红果核心维度复盘】」，用0-100分给出改后版本的：赛道适配、开局节奏、爽点密度、钩子设计、剧本规范、审核合规、人物塑造、商业潜力；每项只写“分数 + 一句判断”。然后输出「【新版情节细纲】」和完整新版情节细纲，不要输出差异对比或补丁。
2. ${modeRule}
3. 必须抓住原有中故事的核心结构、人物关系、阶段状态和前后承接，只按用户建议重排、强化、替换或降噪；不能丢失已有世界观、人设和主线逻辑。
4. 每个中故事仍用【中故事一】、【中故事二】这种标题格式，编号必须连续，不能漏号、跳号或只输出局部。
5. 每个中故事都要保留「详细剧情」和「阶段状态小结」；详细剧情仍是主体篇幅，阶段状态小结要写清主角当前状态、主要人物关系、当前压力、目标方向。
6. 微短剧要保持快冲突、快反转、快打脸、每集钩子和黑场；网文要保持中故事能继续拆成小故事/章节。
7. 男频、事业向、升级流或复仇向微短剧也要少量保留甜宠、打情骂俏、互相试探、暧昧误会、护短或救场后的反向调侃等爱情线桥段，但不能抢主线。
8. 每次重生成都必须执行三密度校准：
   - 情绪密度：每3句话有情绪抬升或转折，每30秒一个钩子，每1分钟一个“压抑→爆发”闭环，每个中故事或每集结尾有情绪余震；少写抽象情绪词，多写动作、代价、关系撕裂和爆发瞬间。
   - 桥段密度：每个有效桥段同时解决当前矛盾、埋新伏笔、推动人物弧光；删除无效解释、平铺过场和为反转而反转。
   - 要素解析：拆解身份反差、关系背刺、复仇打脸、逆袭守护、钱权名安全感与被认可等商业要素的因果、欲望绑定和付费爽点触发方式；必须有机融合，不要机械堆砌。
9. 红果低分项必须在正文中真实修正：爽点密度要更密、更狠、更可发布；钩子设计要避免同质黑场；剧本规范要更标准；审核合规要降低血腥、恐怖、敏感和露骨暴力；人物塑造要让配角有欲望、利益、弱点和选择。
10. 详细剧情不能越写越短：新版每个中故事的「详细剧情」信息量、关键事件数、场景推进层次不得少于原版；禁止把原有详细剧情压缩成摘要、概述或几句总括。如果为了合规删减血腥或敏感内容，必须用关系压迫、证据反转、公开羞辱、限时危机、利益夺取等可发布桥段补足篇幅和戏剧推进。
11. 配角第一次出场不能毫无铺垫：重要配角首次登场前必须有传闻、利益线索、关系伏笔、危机预告、他人评价、物件/场景暗示或旧账牵引；登场时要带着清晰欲望、身份压力、可被利用的弱点，以及与主线冲突的因果连接。不要突然空降只为推动剧情的工具人。
${reviewRiskRule}
请直接输出完整新版情节细纲。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: this.cleanPublicOutlineMetadata(result),
      };
    } catch (error) {
      console.error('根据建议重生成情节细纲失败:', error);
      throw new Error('AI根据建议重生成情节细纲失败，请稍后重试');
    }
  }

	  async generateMicroStories(dto: GenerateMicroStoriesDto) {
	    console.log(`开始为中故事${dto.storyIndex}生成小故事细纲`);

		    const mode: 'novel' | 'microdrama' | 'literature' | 'film' =
		      dto.mode === 'microdrama' ? 'microdrama' : dto.mode === 'literature' ? 'literature' : dto.mode === 'film' ? 'film' : 'novel';
    const unitLabel = mode === 'microdrama' ? '集' : mode === 'film' ? '节拍' : mode === 'literature' ? '章' : '章';
    const rangeInfo = dto.chapterRange
      ? `，对应${mode === 'microdrama' ? '微短剧集数范围' : '小说章节范围'}：第${dto.chapterRange}${unitLabel}`
      : '';
    const rangeUnitCount = mode === 'film'
      ? 1
      : mode === 'literature'
      ? 4
      : dto.chapterRange
      ? this.getRangeUnitCount(dto.chapterRange)
      : (mode === 'novel' ? 15 : 10);
    const rangeParts = dto.chapterRange?.split('-') || [];
    const microdramaLastUnitLabel = dto.chapterRange
      ? `第${rangeParts[rangeParts.length - 1]}集`
      : `第${rangeUnitCount}集`;
	    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
	    const filmStoryCardRules = this.getFilmStoryCardRulesPrompt();
    const microdramaWorldOpeningRule = this.getMicrodramaWorldOpeningRule();
    const microdramaCharacterDepthRule = this.getMicrodramaCharacterDepthRule();
    const microdramaDialogueRealityRule = this.getMicrodramaDialogueRealityRule();
    const microdramaContinuityContext = mode === 'microdrama'
      ? `\n【跨中故事连续性参考】\n上一中故事内容：\n${dto.previousMacroStory?.trim() || '无'}\n\n上一组已生成分集细纲：\n${dto.previousMicroStories?.trim() || '无'}\n\n下一中故事内容（只用于递交方向，不得提前消耗核心爆点）：\n${dto.nextMacroStory?.trim() || '无'}\n`
      : '';

    const prompt = mode === 'microdrama'
      ? `基于以下中故事内容，为这部中故事生成${rangeUnitCount}个单集具体情节细纲${rangeInfo}：

中故事${dto.storyIndex}内容：
${dto.macroStory}
${microdramaContinuityContext}

**任务要求：**
${romanceLineRules}
${microdramaWorldOpeningRule}
${microdramaCharacterDepthRule}
${microdramaDialogueRealityRule}

1. 输出必须是${rangeUnitCount}个单集细纲，顺序连续、集数连续、逻辑闭环清晰；在微短剧模式下，每个单集细纲对应 1 集，且每集只承载约1分钟可拍剧情
2. 每个小故事都必须包含清楚的前因后果：上一集/上一阶段留下了什么问题，本集人物为什么必须出场，人物带着什么目的或误会进入场景，冲突如何因对话升级，最终留下什么结果和余波。
3. 与中故事的主线情节紧密关联
4. 展现不同的叙事角度和人物成长
5. 包含必要的场景、人物动作、关键对白、冲突和转折，但必须精炼；每集只保留1个核心场景，最多1个短转场。人物第一次进入本组或本集时，必须写清“他/她为什么此刻出现”，不能硬插角色。
6. 重要：集数编号要连续，${dto.chapterRange ? `从第${dto.chapterRange.split('-')[0]}集开始` : '从当前集开始'}，确保与整体微短剧集数连续
7. 微短剧节奏硬约束（必须遵守）：
   - 每一集开头要直接进入“有压力的场面”，可以是争执、试探、逼问、公开羞辱、证据摆上桌、暧昧误会、利益交换、身份错位或危险逼近；禁止把所有开头都写成濒死、追杀、爆炸、绑架、坠楼、献祭等生死危机。
   - 危机必须来自前文因果、人物欲望、利益冲突或关系误会，不能凭空砸下来。除首集或中故事明确要求外，优先使用社会性危机、身份危机、情感危机、资源危机、舆论危机、限时选择、证据反转和关系破裂。
   - 如果本组包含【第1集】，第1集细纲必须在危机中简短带出主角身份、所在时代/城市/世界空间、当前处境和最关键世界规则；不要只写“主角濒死/被追杀/被献祭”这类孤立刺激。第1集必须有一个明确的“世界规则入场镜头/道具/声音/他人视角”，让世界观不是突兀背景。
   - 每一集都要完成一次“压力提出 → 对话交锋 → 情绪拉扯/信息揭露 → 选择或反击 → 阶段结果”的闭环
   - 每一集都必须有钩子，集尾不能平；结尾要给下一集留下明确的黑场问题、误会升级、身份揭露、危机倒计时或情感悬念
   - 中段剧情推进必须快，但不能省略动机和承接；每集只安排1个最核心的打压/高燃点/爽点释放/反转打脸，不要堆多个事件
   - 台词是细纲重点：每集至少写出2-4句关键对白或对白方向，必须体现人物立场、欲望、试探、隐瞒、威胁、吃醋、护短或反击。其余描写从简，不要大段环境说明。对白方向必须真实口语化，禁止网文化狠话、霸总腔、尬爽宣言和土味情话。
   - 女频向内容要强化爱情线桥段：允许并鼓励打情骂俏、互动调戏、试探拉扯、吃醋误会、英雄救场、暧昧反差，但不得让关系推进过快或跳过必要铺垫
   - 男频、事业向、升级流或复仇向微短剧也必须保留少量爱情线推进：甜宠照顾、互相调侃、打情骂俏、并肩破局、吃醋护短、暧昧误会、救场后的反向调戏等桥段可以点缀，但比例要少，不能抢走主线爽点
   - 每一集都应至少解决一个当前矛盾，并埋下一个新伏笔/新危机；人物弧线不要求每集都推进，但本组${rangeUnitCount}集里至少必须有1集用明确的剧情行为推进人物弧线
   - 人物弧线推进必须是可拍的剧情行为，而不是一句状态说明：例如主角做出违背旧习惯的选择、为保护某人承担代价、主动反击旧压迫、拒绝诱惑、承认弱点、放弃短利、改变对某人的信任、与反派/压力源发生关键对抗等
   - 承担人物弧线推进的那一集，必须在细纲里写清“具体行为 → 造成的关系/处境变化 → 对后续目标的影响”，但不要额外输出后台字段
   - ${microdramaLastUnitLabel}必须形成这一卡点的黑场悬念或更大反转
   - 如果中故事末尾提供了「阶段状态小结」，本组单集细纲必须把这一组的终点写到该小结指定的主角状态、人物关系、当前压力与下一阶段目标方向
   - 本组第一集开头必须承接上一组最后一个钩子或上一中故事阶段结果；如果没有上一组参考，也要承接本中故事自身的开端目标。${microdramaLastUnitLabel}结尾要把“下一阶段目标方向”自然递给下一中故事，但不要提前写下一中故事的核心爆点
   - 跨中故事衔接硬要求：上一中故事最后一个小故事和当前中故事第一个小故事之间必须有明确接力物，至少包含一个连续元素：未解决问题、同一件证据/道具、同一人物承诺、同一误会、同一追问、同一限时压力或同一情感裂口。
8. 爱情线节奏硬约束（如果本中故事涉及爱情线，必须遵守）：
   - 必须根据中故事剧情内部判断当前爱情线进度、两人关系距离、互动边界和本中故事承载的爱情线位置
   - 本组单集细纲只能在当前中故事已经建立的关系上限内展开与深化，不得越级推进
   - 若中故事为某爱情线的第1-2个承载中故事，严禁写出“确认关系/公开/互许终身/婚嫁落定”等结局性节点
   - 若中故事文本没有明确关系进展，则默认按初识或熟悉早期处理，宁慢勿快，避免闪电攻略
9. 生成前请先按“情绪密度与极值控制 / 桥段密度与钩子调度 / 商业闭环校验”三轮自检并完成二次修正，但不要输出自检过程
10. 单集厚度硬限制：
   - 每集细纲建议控制在220-360字，最多不超过420字
   - 每集只写能拍约1分钟的剧情容量，不要写两三场完整戏，不要把下一集事件提前塞进本集
   - 不要写长段设定解释、长心理分析、复杂支线、多轮反转；这些应分摊到后续集数
   - 输出时优先给“因果承接 + 人物出场理由 + 台词拉扯 + 冲突结果 + 集尾钩子”，不要展开成完整剧本

**输出格式要求：**
- 每个单集细纲用【第X集】的格式标记，X 必须使用全剧绝对集数，例如【第1集】【第2集】或【第6集】
- 每个小故事后面直接跟具体的情节细纲内容。建议包含：承接/出场理由、主要对话拉扯、冲突结果、结尾钩子，但不要把这些词写成固定后台字段。
- 内容要精准可拍，便于后续写作参考，但不要过厚；每集按1分钟剧情容量设计
- 只呈现剧情安排，不要输出“桥段类型”“爱情线一级结构”“好感度”“关系阶段”“爱情线阶段”等后台字段；爱情线信息必须转化为具体动作、对白、拉扯和人物反应

	请直接输出${rangeUnitCount}个单集细纲，不要添加任何额外的说明或格式。`
	      : mode === 'film'
	      ? `基于以下电影故事节拍内容，为第${dto.storyIndex}节拍拆分“场景细纲”。这些场景后续会作为一个整体写成该节拍的电影剧本正文，而不是逐场单独写正文。

当前节拍内容：
${dto.macroStory}

${filmStoryCardRules}

任务要求：
1. 这是电影剧本模式。请根据节拍功能，把本节拍拆成适合拍摄的3-10个场景；大结局节拍可拆到10-16场，开场/主题/终场可少到1-3场。
2. 全片目标80-120场，因此本节拍场数要与节拍体量匹配：铺垫、娱乐和游戏、坏人逼近、大结局可以多；主题陈述、催化剂、失去一切、灵魂黑夜、终场画面要少而准。
3. 每个场景必须写清：场号、内/外景、日/夜、地点、出场人物、场景目的、核心冲突、关键动作/对白、情绪转折、转场方式。
4. 每个场景都要往最市场化、最吸引人的方向设计：必须有可拍动作、人物目标、阻力、关系变化或类型片看点，不能只是说明背景或平淡过场。
5. 场景之间要有电影剪辑逻辑：地点变化、人物行动、信息揭露、时间推进都要清楚。
6. 为后续正文写作服务：关键动作/对白要优先写人物行为和冲突结果，环境、背景、特殊道具只做简要提示。
7. 不要写成小说章节细纲、微短剧单集、网文小故事，也不要输出“中故事”三个字。
8. 场景细纲要能直接喂给正文写作：一个节拍会一次性写成约3000-4000字电影剧本，所有场景都要保留。
9. 如果当前节拍内容中已有“故事卡调用”，必须把这些卡片逐一消化到场景设计里；每张卡至少对应一个具体场景动作、冲突、信息揭露、关系爆点或情绪转折。
10. 如果当前节拍没有显式写出“故事卡调用”，你必须根据节拍名称从对应电影故事卡组里自动选择2-4张，并在场景细纲中自然转化；不要另起说明，也不要把卡片名当场景标题。

输出格式：
【第1场】内/外 日/夜 地点
出场人物：……
场景目的：……
核心冲突：……
关键动作/对白：……
情绪转折：……
转场：……

【第2场】……

请直接输出场景细纲，不要输出说明。`
	      : mode === 'literature'
	      ? `基于以下中故事内容，为文学作品的第${dto.storyIndex}章生成若干“小节”细纲。

中故事${dto.storyIndex}内容（在文学作品模式下，这个中故事就是一个大章）：
${dto.macroStory}

任务要求：
1. 一个中故事对应一章。请把本章拆成3-5个小节，默认4个小节；每个小节是本章内部的叙事段落，不是单独章节。
2. 输出格式必须是【第${dto.storyIndex}章第一小节】、【第${dto.storyIndex}章第二小节】这样的格式；如果需要3-5小节，可顺延到第三、第四、第五小节。
3. 文学作品模式要降低网文味：不要危机开头模板、不要章尾强钩子、不要打脸爽点、不要装逼、不要系统/金手指/升级/神器宝物，不要“压抑→爆发”的商业闭环。
4. 正常叙事即可：把故事讲清楚，把人物刻画到位，重视生活细节、场景质感、人物沉默、误解、亏欠、关系变化、时代/环境压力和内心选择。
5. 每个小节要写清：发生地点、主要出场人物、具体事件、人物关系或心理的微妙变化、这一小节对本章主题和下一小节的推动。
6. 小节之间要自然递进，允许留余韵，但不要刻意悬念化；最后一个小节要完成本章的阶段落点。
7. 只输出小节细纲，不要输出创作说明、技法名、后台字段或分析过程。

请直接输出本章3-5个小节细纲。`
	      : `基于以下中故事内容，为这部中故事生成${rangeUnitCount}个单章小故事细纲${rangeInfo}：

中故事${dto.storyIndex}内容：
${dto.macroStory}

**任务要求：**
${romanceLineRules}

请基于这个中故事的具体情节内容，自动抽取并设计${rangeUnitCount}个单章小故事，每个小故事只服务1章正文，后续写作时每章会按用户设置的目标字数单独生成，默认约2100字。
1. 输出必须是${rangeUnitCount}个单章细纲，顺序连续、章节连续、逻辑清楚；每个小故事对应 1 章。
2. 每个单章小故事都要包含完整的当章推进：危机开头→快速推进→高燃点/爽点释放→阶段反转→章尾钩子。
3. 与中故事的主线情节紧密关联，但不能把后续章节的关键结果提前写进当前章。
4. 展现不同的叙事角度和人物成长。
5. 包含具体的场景描述、对话、冲突和转折，内容要详细具体到可直接扩写成一章正文。
6. 每章必须以具体危机开头，不能用平静铺垫；推进过程中至少安排一次高燃点或爽点释放，例如反杀、打脸、破局、夺回资源、揭露真相、情感爆发或实力升级。
7. 如果本组包含【第1章】，第1章细纲必须在危机推进中简短带出主角身份、所处时代/世界空间、当前阶层/家庭/职业处境和最关键世界规则；不要只写“生死危机/追杀/濒死”而缺少故事来龙去脉。
8. 每章结尾必须留钩子，为下一章留下更大危机、未解谜团、关系变化、敌人反扑或目标升级；只留钩子，不要开始解决钩子。
9. 重要：章节编号要连续，${dto.chapterRange ? `从第${dto.chapterRange.split('-')[0]}章开始` : '从当前章节开始'}，确保与整体小说章节连续。
10. 输出的小故事细纲只能呈现剧情安排，不要写出“小故事卡”“技法卡”“一级结构”“卡点定位”“桥段类型”“爱情线一级结构”“好感度”“关系阶段”“爱情线阶段”等后台标签或卡片内容；如果需要体现爱情线，只写成剧情动作、对话和人物反应。

**输出格式要求：**
- 每个单章小故事用全书绝对章节号标记，例如【第1章】【第2章】...
- 每个小故事后面直接跟具体的情节细纲内容
- 内容要详细具体，便于后续写作参考

请直接输出${rangeUnitCount}个单章小故事细纲，不要添加任何额外的说明或格式。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: this.cleanPublicOutlineMetadata(result),
      };
    } catch (error) {
      console.error(`生成中故事${dto.storyIndex}的小故事细纲失败:`, error);
      throw new Error('AI生成小故事细纲超时，请稍后重试');
    }
  }

  async generateMicroStoryVariants(dto: GenerateMicroStoryVariantsDto) {
    const mode: 'novel' | 'microdrama' | 'film' = dto.mode === 'microdrama' ? 'microdrama' : dto.mode === 'film' ? 'film' : 'novel';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
    const microdramaWorldOpeningRule = this.getMicrodramaWorldOpeningRule();
    const microdramaCharacterDepthRule = this.getMicrodramaCharacterDepthRule();
    const microdramaDialogueRealityRule = this.getMicrodramaDialogueRealityRule();
    if (dto.targetType === 'macro') {
      const selectedBase = dto.selectedVariantContent
        ? `\n【用户当前更认可的中故事候选版本】\n标题：${dto.selectedVariantTitle || dto.currentTitle}\n内容：${dto.selectedVariantContent}\n`
        : '';
      const noteText = dto.note?.trim()
        ? `\n【用户批注 / 继续优化方向】\n${dto.note.trim()}\n`
        : '';
      const isOpeningMacroStory = mode === 'microdrama' && !String(dto.previousContent || '').trim();
      const openingMacroRule = isOpeningMacroStory
        ? `\n【首个中故事开局硬要求】\n当前是首个中故事时，必须同时做到：介绍清楚主角是谁、交代清楚本剧主线追什么、制造清楚会毁掉主角的生死/命运危机，并把世界观背景嵌进同一条危机事件链。人物介绍、主线介绍和世界规则不能先硬介绍再硬危机。允许使用追杀、濒死、献祭、爆炸、绑架、坠楼、战斗等强刺激手段，但这些手段必须服务人物和主线。第1集详细剧情必须写出主角姓名/身份、家庭或职业处境、所在时代/城市/世界空间、主角当前最想保住或夺回的东西、本剧后续核心方向、最关键世界规则，以及危机如何把这些东西逼到不可逆。危机可以是生命危险、社会性死亡、亲密关系毁灭、身份被夺、事业彻底断送或命运被锁死，但必须让观众知道这个人为什么不能输。\n${microdramaWorldOpeningRule}\n`
        : '';
      const prompt = `请基于以下资料，为当前中故事重构 3 个新的方案。

【世界观设定】
${dto.worldSetting || '无'}

【人物设定】
${dto.characters || '无'}

【上一个中故事，作为前文承接】
${dto.previousContent || '无'}

【当前中故事原方案】
标题：${dto.currentTitle}
内容：${dto.currentContent}

【下一个中故事，作为后文边界】
${dto.nextContent || '无'}
${selectedBase}${noteText}
感情线硬规则：
${romanceLineRules}
${openingMacroRule}
${mode === 'microdrama' ? `${microdramaCharacterDepthRule}\n${microdramaDialogueRealityRule}` : ''}

重构目标：
1. 一次性输出 3 个候选中故事方案，三条必须明显不同，不能只是换说法。
2. 每个方案都必须比原方案更完整，但「卡点定位/目的/技法卡/一级结构/承载主线/情绪骨架/商业要素/节点」只能短标注，真正篇幅必须放在「详细剧情」。
3. 必须结合世界观和人物设定，不能脱离已有角色动机、能力边界、势力关系和世界规则。
4. 必须兼顾上下中故事连续性：承接前文已经发生的结果，不提前消耗后文核心爆点。
5. ${mode === 'microdrama'
        ? '按爆款微短剧中故事设计：必须承接当前中故事已标注的对应集数，内部每集都要有惊艳开场、快节奏推进、打压、高潮、反转、打脸和最后一集黑场钩子；每一集只承载约1分钟可拍剧情，详细剧情要精准但不要过厚；本中故事内部至少要有一处明确的剧情行为推进人物弧线，例如选择、牺牲、反击、护短、示弱、拒绝诱惑或改变信任，不能只写状态变化；人物动机不能只剩拜金、自私或单纯作恶，必须让关键选择带出人性挣扎；女频内容要强化爱情线桥段、打情骂俏、男女主互动试探拉扯和情感误会，但台词必须真实口语化，不得霸总腔、土味化、网文尬爽化，也不得让关系推进过快；结尾必须追加「阶段状态小结」。'
          : '按小说中故事设计：默认能继续拆成15个单章小故事；首个中故事以生死为局开头，后续中故事以重大危局开头，内部要有完整目标、阻碍、升级、高燃点/爽点释放、阶段高潮、结尾扣子和阶段收束；详细剧情必须写到可继续拆成单章细纲的程度。'}
6. 若提供了用户批注，必须显著响应批注；若提供了用户认可的候选版本，以它为优化基础。
7. 当前中故事开头必须精准承接【上一个中故事】结尾的结果、主角状态、关系变化、当前压力与“目标方向”；如果上一个中故事为空，则按本作品开局逻辑处理。
8. 当前中故事结尾必须把主角推进到一个清晰的新阶段，并留下可递交给下一中故事的目标方向；如果【下一个中故事】已存在，严禁改写它已经建立的开头前提，严禁提前消耗它的核心爆点，只能把结尾目标自然对齐到它的开局。
9. 若当前是第3个中故事这类中段替换场景，方案必须同时满足：开头接住第2个中故事的结尾目标，结尾不破坏第4个中故事已有开头。
10. 「详细剧情」必须占每个方案总字数的70%以上；禁止把详细剧情写成两三句概述，必须按每集或关键章节段落展开。

输出格式必须严格如下：
【方案一】标题
内容：卡点定位/目的/技法卡/一级结构/承载主线/情绪骨架/商业要素只短标注；详细剧情：……（占本方案70%以上，按每集或关键章节段落展开）
阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

【方案二】标题
内容：卡点定位/目的/技法卡/一级结构/承载主线/情绪骨架/商业要素只短标注；详细剧情：……（占本方案70%以上，按每集或关键章节段落展开）
阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

【方案三】标题
内容：卡点定位/目的/技法卡/一级结构/承载主线/情绪骨架/商业要素只短标注；详细剧情：……（占本方案70%以上，按每集或关键章节段落展开）
阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

不要输出额外说明。`;

      try {
        const result = await this.chatWithSelectedLogicModel([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: prompt }
        ], dto);

        return {
          success: true,
          data: this.cleanPublicOutlineMetadata(result),
        };
      } catch (error) {
        console.error('生成中故事候选方案失败:', error);
        throw new Error('AI生成中故事候选方案失败，请稍后重试');
      }
    }

    const unitLabel = mode === 'microdrama' ? '集' : '小故事';
    const targetStories = (dto.targetStories || []).filter(s => s && s.content);
    const isBatchRewrite = targetStories.length >= 1;
    const selectedBase = dto.selectedVariantContent
      ? `\n【用户当前更认可的候选版本】\n标题：${dto.selectedVariantTitle || dto.currentTitle}\n内容：${dto.selectedVariantContent}\n`
      : '';
    const selectedBatchBase = dto.selectedVariantStories?.length
      ? `\n【用户当前更认可的一整套候选版本】\n${dto.selectedVariantStories.map(s => `第${s.index + 1}${unitLabel}\n标题：${s.title}\n内容：${s.content}`).join('\n\n')}\n`
      : '';
    const noteText = dto.note?.trim()
      ? `\n【用户批注 / 继续优化方向】\n${dto.note.trim()}\n`
      : '';

    const prompt = isBatchRewrite
      ? `请基于以下资料，为用户选中的连续${unitLabel}段落重新设计 3 套“连续改写方案”。

【所属中故事内容】
${dto.macroStory}

【选中段落之前的衔接参考】
${dto.previousContent || '无'}

【用户选中的${targetStories.length}个${unitLabel}原方案】
${targetStories.map(s => `第${s.index + 1}${unitLabel}\n标题：${s.title}\n内容：${s.content}`).join('\n\n')}

【选中段落之后的衔接边界】
${dto.nextContent || '无'}
${selectedBatchBase}${noteText}
感情线硬规则：
${romanceLineRules}
${mode === 'microdrama' ? `${microdramaCharacterDepthRule}\n${microdramaDialogueRealityRule}` : ''}

生成目标：
1. 一次性输出 3 套候选方案，每套都必须覆盖用户选中的全部${targetStories.length}个${unitLabel}，不能漏项，不能只改其中一个。
2. 每套方案内部必须连续，前后因果要咬合：第一个${unitLabel}制造的问题，后续${unitLabel}要承接、升级或反转。
3. 三套方案之间必须明显不同，例如冲突核心、人物主动性、反转机制、情绪爆点或结尾钩子不同。
4. 必须兼顾选中段落前后的连续性，不能改坏前文动机，也不能提前消耗后文核心爆点。
5. 必须服从所属中故事的主线卡点，不要跳出当前中故事。
6. ${mode === 'microdrama'
        ? '按爆款微短剧连续单集思维设计：每集都要有压力场面、快节奏升级、人物性格外化、打压、高潮、反转、打脸和结尾钩子；但危机必须来自前后因果、人物欲望、利益冲突或关系误会，禁止把所有开头都写成濒死、追杀、爆炸、绑架等孤立生死刺激。每集只写约1分钟可拍剧情容量，单集细纲控制在220-360字，最多不超过420字；必须写清人物为什么此刻出场，至少给出2-4句关键对白或对白方向，用台词承载情感拉扯、试探、威胁、隐瞒、护短或反击；台词必须真实口语化，有潜台词和情绪逻辑，禁止霸总腔、网文狠话和土味调戏；女频内容要加入爱情线桥段、男女主互动试探拉扯或暧昧误会，同时整段形成更大的连续推进；这一组连续单集里至少有一集必须通过具体剧情行为推动人物弧线，不能只写“主角成长/关系变化”这类概括。'
        : '按小说连续小故事思维设计：每个小故事都要以危机开头，推进中释放高燃点或爽点，结尾留下钩子；同时整段形成章节群推进。'}
7. 若提供了用户批注，必须显著响应批注；若提供了用户认可的一整套候选版本，以它为优化基础。

输出格式必须严格如下：
【方案一】方案标题
【第${targetStories[0].index + 1}${unitLabel}】标题
内容：……
${targetStories.slice(1).map(s => `【第${s.index + 1}${unitLabel}】标题\n内容：……`).join('\n')}

【方案二】方案标题
${targetStories.map(s => `【第${s.index + 1}${unitLabel}】标题\n内容：……`).join('\n')}

【方案三】方案标题
${targetStories.map(s => `【第${s.index + 1}${unitLabel}】标题\n内容：……`).join('\n')}

不要输出额外说明。`
      : `请基于以下资料，为当前${unitLabel}重新设计 3 个更丰富、更可拍、更强戏剧性的剧内解决方案。

【所属中故事内容】
${dto.macroStory}

【上一${unitLabel}内容，作为连续性参考】
${dto.previousContent || '无'}

【当前${unitLabel}原方案】
标题：${dto.currentTitle}
内容：${dto.currentContent}

【下一${unitLabel}内容，作为衔接边界】
${dto.nextContent || '无'}
${selectedBase}${noteText}
感情线硬规则：
${romanceLineRules}
${mode === 'microdrama' ? `${microdramaCharacterDepthRule}\n${microdramaDialogueRealityRule}` : ''}

生成目标：
1. 一次性输出 3 个候选方案，三条必须明显不同，不能只是换说法。
2. 每个方案都要比原方案更具体，包含可执行的场景推进、人物动作、冲突升级、反转点和结尾钩子。
3. 必须兼顾前后连续性：不能改坏上一${unitLabel}已经建立的动机，也不能提前消耗下一${unitLabel}的核心爆点。
4. 必须服从所属中故事的主线卡点，不要跳出当前中故事。
5. ${mode === 'microdrama'
      ? '按爆款微短剧单集思维设计：开场必须有压力并立即抓人，但危机必须来自前后因果、人物欲望、利益冲突或关系误会，禁止凭空塞濒死、追杀、爆炸、绑架等孤立生死刺激；中段快节奏推进，人物性格鲜明，有打压、有高潮、有反转、有打脸，结尾为下一集留下强钩子；必须写清人物为什么此刻出场，至少给出2-4句关键对白或对白方向，用台词承载情感拉扯、试探、威胁、隐瞒、护短或反击；台词必须真实口语化，有潜台词和情绪逻辑，禁止霸总腔、网文狠话和土味调戏；若当前单集承担本中故事的人物弧线推进，必须用具体剧情行为体现，例如选择、牺牲、反击、护短、示弱、拒绝诱惑或改变信任，而不是写一句状态变化；女频内容要加入爱情线桥段、男女主互动试探拉扯或暧昧误会；内容应便于继续扩成单集剧本。'
        : '按小说单章小故事思维设计：每个小故事只服务1章，写清危机开头、冲突递进、高燃点/爽点释放、阶段反转、章尾钩子和当章收束。'}
6. 若提供了用户批注，必须显著响应批注；若提供了用户认可的候选版本，以它为优化基础，而不是退回原方案。

输出格式必须严格如下：
【方案一】标题
内容：……

【方案二】标题
内容：……

【方案三】标题
内容：……

不要输出额外说明。`;

    try {
      const result = await this.chatWithSelectedLogicModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ], dto);

      return {
        success: true,
        data: this.cleanPublicOutlineMetadata(result),
      };
    } catch (error) {
      console.error('生成单集/小故事候选方案失败:', error);
      throw new Error('AI生成候选方案失败，请稍后重试');
    }
  }

  private buildMicrodramaEpisodePrompt(
    contextMemory: string,
    episodeNumber: number,
    previousEnding: string,
    storyData?: any,
    actionFirstScript = false,
    dialogueFirstScript = false,
    targetEpisodeWords?: number,
  ): string {
    const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
    const normalizedTargetWords = Number.isFinite(targetEpisodeWords)
      ? Math.min(5000, Math.max(500, Math.round(targetEpisodeWords as number)))
      : 800;
    const minTargetWords = Math.max(450, Math.round(normalizedTargetWords * 0.9));
    const maxTargetWords = Math.round(normalizedTargetWords * 1.1);
    const worldOpeningRule = this.getMicrodramaWorldOpeningRule();
    const characterDepthRule = this.getMicrodramaCharacterDepthRule();
    const dialogueRealityRule = this.getMicrodramaDialogueRealityRule();
    const firstEpisodeSetupRequirement = episodeNumber === 1
      ? `\n首集开场特别要求（必须执行，优先级高于普通爆点规则）：\n- 第1集必须同时完成四件事：介绍清楚主角是谁、交代清楚本剧主线追什么、制造清楚会毁掉主角的生死/命运危机、让观众理解这个世界最关键的背景规则。四者必须融合在同一条事件链里，不能分成硬介绍、硬设定和硬危机。\n- 允许使用追杀、濒死、献祭、爆炸、绑架、坠楼、战斗等强刺激手段，但这些手段必须服务人物和主线；首场必须通过可拍细节让观众看懂：主角姓名/身份、家庭或职业处境、所处时代/城市/世界空间、主角当前最想保住或夺回的东西。\n- 主线和世界观介绍必须嵌入动作和冲突里，例如一张欠款单/退婚书/公司任命/家族遗嘱/入学通知/病例/契约/审判书/直播弹幕/祭坛规则/行业公告/校园广播/新闻字幕，让观众知道后续故事的核心方向：复仇、翻身、守护、查真相、夺回身份、改变命运或完成某个目标。\n- 生死危机仍然必须体现。危机可以是生命危险、社会性死亡、亲密关系毁灭、身份被夺、事业彻底断送或命运被锁死；它必须和主角身份、目标、主线方向发生因果关系。\n- 推荐首集结构：第1场用危机前沿事件介绍人物、世界规则与主线目标；第2场让压力方出手，把主线目标逼成不可逆危局；第3场如有，只用于主角第一次选择/反击或更大黑场钩子。\n- 禁止用旁白或大段设定说明介绍世界观；所有背景都要通过工牌、债务单、祭坛规则、校园广播、公司会议、家族宴席、系统提示、群众议论、新闻字幕、道具或对方台词自然带出。\n${worldOpeningRule}\n`
      : '';
    const actionFirstRequirement = actionFirstScript
      ? `\n动作主导模式（用户已开启，必须优先执行）：\n- 本集剧本以动作、镜头调度、人物行为、场面变化、道具使用、身体距离、表情反应和环境压力为主，台词为辅。\n- 每场戏至少 60% 篇幅写可拍摄动作/镜头/反应，台词只负责制造冲突、反讽、信息增量和情绪爆点，不要用长台词解释剧情。\n- 连续台词不能超过 2 行；每 1-2 句台词后必须插入可见动作、表情、走位、道具或镜头反应。\n- 关键爽点、反转、打脸、暧昧拉扯和危机升级都要优先通过“看得见的行为”呈现，而不是靠角色把结果说出来。\n`
      : '';
    const dialogueFirstRequirement = dialogueFirstScript && !actionFirstScript
      ? `\n台词主导模式（用户已开启，必须优先执行）：\n- 在原有剧本基础上进一步提高台词密度：本集主要通过角色对白推进冲突、情感拉扯、信息揭露、试探、威胁、护短、吃醋、误会和反击。\n- 每场戏必须有连续的对话交锋，关键人物至少各有2-4句有立场、有潜台词、有情绪方向的台词；台词不能只是解释设定，要互相施压、反问、刺探或逼对方选择。\n- 动作和镜头说明只保留必要的表演支点、停顿、距离变化、道具反应和场面结果，避免大段环境铺陈压过对白。\n- 感情线相关内容优先写试探、调侃、护短、吃醋、误会、退让、嘴硬或反向关心；事业线/复仇线优先写谈判、逼问、威胁、反讽、揭穿和宣告。\n- 仍要保持可拍剧本格式：对白更密，但每段对白之间可用短动作承接，不要变成纯聊天或脱离本集主线。\n`
      : '';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
    const storyReference = this.buildStoryBoundaryReference(storyData, 'microdrama');
    const planningLeakRule = this.getPlanningLeakRule();
    return `${contextMemory}

请基于以上完整的故事背景信息，生成第${episodeNumber}集的标准微短剧正文。

${previousEnding ? `上一集结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一集最后一句（必须在本集开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}
${storyReference}

感情线硬规则：
${romanceLineRules}
${characterDepthRule}
${dialogueRealityRule}
${firstEpisodeSetupRequirement}

本集主线施工图（只在内部执行，最终严禁输出）：
- 先用一句话确定本集唯一主线：主角本集想要什么、谁/什么阻止、主角采取什么关键行动、得到什么阶段结果、留下什么下一集问题。
- 再确定2-3场戏的因果顺序：因为上一场发生了什么，所以这一场才发生什么；每一场都必须承接上一场的结果。
- 检查每句对白和每个动作是否服务本集主线；不服务主线的桥段、玩笑、反转、设定解释、恋爱互动必须删除或压缩。对白不能只追求“爽句”，必须符合人物身份、关系距离和当下情绪逻辑。
- 如果当前分集细纲本身信息较散，必须把它收束成一条清晰行动线，不要并排堆多个事件。
- 如果这是第1集，内部施工图必须先确认：主角身份、世界关键规则、主线目标、主角最怕失去的东西、危机如何把主线目标逼到不可逆；不能把“生死危机”当成唯一主线。

写作目标：
1. 输出标准微短剧拍摄剧本格式，不要写成小说正文、散文旁白或分集梗概。
2. 单集目标字数约 ${normalizedTargetWords} 字，允许在 ${minTargetWords}-${maxTargetWords} 字之间浮动；必须是可拍摄的完整剧本，不要明显短于或长于用户设定。
3. 本集默认 2-3 场。500字左右优先写2场完整戏；只有剧情容量足够时才写3场。每场都要有清晰场号、时间、内外景、地点、人物、画面动作和对白。
4. 以对白和可见动作为主，少写心理描写；所有动作说明必须是镜头能拍到、演员能表演的内容。
5. 严格遵循当前分集细纲，不能跑去写下一集的内容。
6. 单集主线优先级高于爆点密度：必须让观众清楚“本集谁要做什么、为什么受阻、怎么反击、结果如何”。禁止为了塞爆点牺牲主线连贯。
7. 开场第一场必须直接进入本集主冲突：可以有冲突、羞辱、生死压力、身份失衡、强压局面、暧昧误会、关系爆雷或危险逼近，但必须同时交代主角处境和本集行动目标，不能只给孤立刺激。若是第1集，人物介绍和主线介绍比危机强度更优先，但危机必须自然压进来。
8. 对话必须口语化、有情绪方向和信息增量，禁止连续三句平直陈述，禁止长篇解释设定；严禁过度网文化、霸总腔、尬爽宣言、鸡皮疙瘩式土味情话和“作者替角色说教”的台词。
9. 每场戏只承担一个清晰功能：第一场承接上一集并建立本集主冲突；第二场推动冲突升级并让主角采取关键行动；第三场如有，则用于结果反转、阶段收束和下一集钩子。不要要求每场同时解决矛盾、埋伏笔、完成人物弧光。
10. 中段推进必须快，但要按因果升级：压力升级 -> 主角行动 -> 对方反制或局势反转 -> 阶段结果。禁止突然换场、突然出现新人物、突然抛新设定、突然完成反转。
11. 人物性格要鲜明外化，主角要有可见反击、选择或态度变化，反派/压力方要有具体打压动作；所有行为必须能看出动机，不能只为制造爽点。人物不能只剩拜金、自私或单纯作恶，必须通过短动作、停顿、回避、犹豫、保护、失控或自我辩护露出人性挣扎。
12. 女频微短剧要强化爱情线桥段：男女主可以打情骂俏、互相调戏、试探拉扯、吃醋误会、英雄救场、身体距离变化或暧昧反差；这些互动必须推动冲突和关系，不要写成纯闲聊。
13. 男频、事业向、升级流或复仇向微短剧也要保留少量爱情线推进：甜宠照顾、互相调侃、打情骂俏、并肩破局、吃醋护短、暧昧误会、救场后的反向调戏等桥段可以点缀，但比例要少，不能抢走主线爽点。
14. 结尾必须切在更大的危机、秘密揭露、身份反转、生死倒计时、暧昧误会升级或关系爆雷上，形成下一集黑场钩子。
15. 衔接要求：如果提供了“上一集结尾内容”，本集开头必须从该结尾自然续写，延续同一场景/动作/对话，不要回顾式重述；如果需要换场，必须先用一个可拍的动作或结果完成转场。
16. ${planningLeakRule}
${actionFirstRequirement}${dialogueFirstRequirement}

必须使用以下格式：
第${episodeNumber}集：[集标题]

${episodeNumber}-1 日/夜 内/外 地点
人物：角色A、角色B
△ 可拍摄的场景、人物动作、表情、道具、声响或镜头提示。
角色A（情绪/动作）：对白。
△ 可拍摄的动作或反应。
角色B（情绪/动作）：对白。

${episodeNumber}-2 日/夜 内/外 地点
人物：角色A、角色C
△ 可拍摄的场景和动作。
角色C（情绪/动作）：对白。

格式硬规则：
- 场号必须写成“${episodeNumber}-1”“${episodeNumber}-2”这种格式。
- 每场开头必须有“人物：”。
- 动作、场景、镜头、音效、特写、转场等说明以“△”开头；可少量使用“特写：”“闪回：”“黑屏：”“字幕：”等独立标记。
- 对白格式必须是“角色名（情绪/动作）：对白”，不用引号。
- 不要输出“写作目标”“本集钩子说明”“体检报告”“下面是剧本”等额外说明。
- 不要输出“小故事卡”“技法卡”“一级结构”“卡点定位”“阶段状态小结”“当前剧情参考”等任何创作后台标签。
- 不要把大段剧情写成自然段；每一行都要像拍摄剧本一样可拆解执行。

请直接输出该集剧本正文。`;
  }

  private normalizeNovelTargetWords(targetNovelWords?: number): number {
    return Number.isFinite(targetNovelWords)
      ? Math.min(5000, Math.max(800, Math.round(targetNovelWords as number)))
      : 2100;
  }

  private normalizeFilmTargetWords(targetWords?: number): number {
    return Number.isFinite(targetWords)
      ? Math.min(5000, Math.max(2500, Math.round(targetWords as number)))
      : 3600;
  }

  private buildFilmBeatPrompt(
    context: string,
    beatNumber: number,
    previousEnding: string,
    storyData?: any,
    targetWords?: number,
  ): string {
    const normalizedTargetWords = this.normalizeFilmTargetWords(targetWords);
    const minTargetWords = Math.max(2400, Math.round(normalizedTargetWords * 0.9));
    const maxTargetWords = Math.min(5000, Math.round(normalizedTargetWords * 1.12));
    const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
    const storyReference = this.buildStoryBoundaryReference(storyData, 'film');

    return `${context}

请基于以上完整背景信息，生成第${beatNumber}节拍的标准中文电影剧本正文。

${previousEnding ? `上一节拍结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一节拍最后一句（可自然承接，不必机械复写）：\n${previousLastSentence}\n\n` : ''}` : ''}
${storyReference}

写作目标：
1. 本次只写第${beatNumber}节拍，不要提前写下一节拍；但要在结尾形成自然的节拍推进。
2. 字数目标约 ${normalizedTargetWords} 字，允许 ${minTargetWords}-${maxTargetWords} 字之间自然浮动。一个节拍应把该节拍下的所有场景完整写成电影剧本段落。
3. 使用标准中文电影剧本格式，不要写成小说、散文、分集梗概或微短剧脚本。
4. 必须把“场景细纲”里的每个场景都转化为可拍剧本：场号、内/外景、日/夜、地点、出场人物、动作说明、对白、转场要清楚。
5. 必须继承节拍大纲或场景细纲里的“故事卡调用”：把卡片转化成可拍动作、关系压力、信息揭露、选择代价或情绪反转。不要在正文里解释卡片名，也不要把卡片当后台标签输出。
6. 动作主导，台词辅助：整体上“动作/行为/反应/走位”和“对白”的篇幅比例约1:1。不要出现大段环境描写压过人物行动，也不要连续对白堆成话剧。
7. 环境、背景、特殊道具只做短促说明：每场开头用1-3行交代空间、关键道具、危险条件或视觉基调即可，随后立刻进入人物行动和冲突。
8. 每1-2句对白后必须插入人物动作、表情反应、走位、道具使用、沉默、距离变化、镜头动作或事件结果；连续纯对白不得超过2行。
9. 动作说明必须可拍、可演、可剪辑：用人物做了什么、看见什么、拿起什么、避开什么、靠近谁、沉默多久、如何反应来呈现心理变化；少写抽象心理和文学性环境铺陈。
10. 对白要符合电影：短、准、有潜台词，只承担冲突、试探、隐瞒、揭露、压迫或反击功能；不要长篇解释设定。
11. 每场戏都必须有场景目的和冲突推进，不能只是聊天或说明背景。
12. 节拍功能要明确：如果这是开场画面/终场画面，要有视觉对照；如果是主题陈述，要有一句角色可说出口的主题句；如果是中点，要明确伪胜利或伪失败；如果是失去一切/灵魂黑夜，要写出伪死亡和内在领悟；如果是大结局，要写出行动解决方案。
13. ${this.getPlanningLeakRule()}

格式示例：
第${beatNumber}节拍：[节拍名或短标题]

${beatNumber}-1 内/外 日/夜 地点
人物：角色A、角色B
△ 一到三行交代关键环境/道具/危险条件，然后立刻进入人物动作。
△ 角色A做出具体动作，引发角色B反应。
角色A（情绪/动作）：对白。
△ 动作/反应/转场。
角色B（情绪/动作）：对白。
△ 人物动作或事件结果推进冲突。

${beatNumber}-2 内/外 日/夜 地点
人物：角色A、角色C
△ 场景继续推进。

格式硬规则：
- 场号必须写成“${beatNumber}-1”“${beatNumber}-2”这种格式。
- 每场开头必须有“人物：”。
- 动作、场景、镜头、音效、特写、转场等说明以“△”开头。
- 对白格式必须是“角色名（情绪/动作）：对白”，不用引号。
- “△”动作说明必须主要写人物行为、反应、走位、道具和冲突结果；环境描写只能短，不能长段铺陈。
- 保持动作与对白大致1:1：不要连续三段“△”都在写环境，也不要连续三行都是对白。
- 不要输出“写作目标”“场景目的”“节拍功能说明”等后台字段。

请直接输出第${beatNumber}节拍电影剧本正文。`;
  }

  private buildNovelLengthRewritePrompt({
    content,
    chapterNumber,
    targetWords,
    context,
    storyData,
    previousEnding,
  }: {
    content: string;
    chapterNumber: number;
    targetWords: number;
    context: string;
    storyData?: any;
    previousEnding?: string;
  }): string {
    const currentWords = this.getWordCount(content);
    const minTargetWords = Math.max(700, Math.round(targetWords * 0.92));
    const maxTargetWords = Math.min(2600, Math.round(targetWords * 1.08));
    const storyReference = this.buildStoryBoundaryReference(storyData, 'novel');
    const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';

    return `请把下面已经生成的网文第${chapterNumber}章，按目标字数重新写成更精炼的成稿版本。

【背景参考】
${context || '无'}

${previousEnding ? `【上一章衔接参考】\n${previousEnding}\n${previousLastSentence ? `上一章最后一句：${previousLastSentence}\n` : ''}\n` : ''}
${storyReference}

【当前第${chapterNumber}章原文，约${currentWords}字】
${content}

重写任务：
1. 目标字数约 ${targetWords} 字，允许 ${minTargetWords}-${maxTargetWords} 字之间自然浮动；重点是压缩冗余，不要为了字数硬凑。
2. 必须输出完整的第${chapterNumber}章正文，而不是摘要、修改建议、差异说明或补丁。
3. 保留原文的核心冲突、人物选择、爽点/高燃点、感情线状态、章节结尾钩子和与下一章的承接边界。
4. 压缩重复心理、重复解释、过长铺陈、可合并的动作和过度设定说明；保留关键场景的可读性。
5. 只写当前小故事/当前章节范围，不要提前写下一章、下一小故事的行动、结果或反转。
6. ${this.getPlanningLeakRule()}

请直接输出重写后的第${chapterNumber}章正文。`;
  }

  private async enforceNovelChapterLength({
    content,
    chapterNumber,
    context,
    storyData,
    nextStoryData,
    previousEnding,
    writerModelProvider = 'deepseek',
    writerModel,
  }: {
    content: string;
    chapterNumber: number;
    context: string;
    storyData?: any;
    nextStoryData?: any;
    previousEnding?: string;
    writerModelProvider?: WriterModelProvider;
    writerModel?: string;
  }): Promise<string> {
    const currentWords = this.getWordCount(content);
    if (currentWords <= 3000) return content;

    const targetWords = Math.min(2400, Math.max(2000, Math.round(currentWords * 0.7)));
    console.log(`第${chapterNumber}章范围校验后仍超过3000字(${currentWords}字)，启动约30%自动压缩，目标约${targetWords}字`);

    try {
      const rewritten = await this.llmService.chatWithWriterModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        {
          role: 'user',
          content: this.buildNovelLengthRewritePrompt({
            content,
            chapterNumber,
            targetWords,
            context,
            storyData,
            previousEnding,
          }),
        },
      ], writerModelProvider, writerModel);

      const trimmedRewrite = rewritten
        ? await this.validateAndTrimChapterScope({
            content: rewritten,
            chapterNumber,
            storyData,
            nextStoryData,
            mode: 'novel',
            writerModelProvider,
            writerModel,
          })
        : '';

      if (!trimmedRewrite) return content;
      const rewrittenWords = this.getWordCount(trimmedRewrite);
      console.log(`第${chapterNumber}章自动压缩完成：${currentWords}字 -> ${rewrittenWords}字`);
      return trimmedRewrite;
    } catch (error) {
      console.error(`第${chapterNumber}章自动压缩失败，保留原文:`, error);
      return content;
    }
  }

  private async postProcessGeneratedChapter({
    content,
    chapterNumber,
    context,
    storyData,
    nextStoryData,
    previousEnding,
    mode,
    writerModelProvider = 'deepseek',
    writerModel,
  }: {
    content: string;
    chapterNumber: number;
    context: string;
    storyData?: any;
    nextStoryData?: any;
    previousEnding?: string;
    mode: 'novel' | 'microdrama' | 'film';
    writerModelProvider?: WriterModelProvider;
    writerModel?: string;
  }): Promise<string> {
    if (!content) return '';

    const rawWords = this.getWordCount(content);
    if (mode === 'novel' && rawWords > 3000) {
      console.log(`第${chapterNumber}章生成后${rawWords}字，先执行小故事边界校验，裁剪越界内容后再判断是否压缩`);
    }

    const scopedContent = await this.validateAndTrimChapterScope({
      content,
      chapterNumber,
      storyData,
      nextStoryData,
      mode,
      writerModelProvider,
      writerModel,
    });

    if (mode !== 'novel' || !scopedContent) {
      return scopedContent;
    }

    const scopedWords = this.getWordCount(scopedContent);
    if (rawWords > 3000 && scopedWords !== rawWords) {
      console.log(`第${chapterNumber}章边界校验后字数：${rawWords}字 -> ${scopedWords}字`);
    }

    if (scopedWords <= 3000) {
      if (rawWords > 3000) {
        console.log(`第${chapterNumber}章边界校验后已不超过3000字，不启动压缩`);
      }
      return scopedContent;
    }

    return this.enforceNovelChapterLength({
      content: scopedContent,
      chapterNumber,
      context,
      storyData,
      nextStoryData,
      previousEnding,
      writerModelProvider,
      writerModel,
    });
  }

  async generateChapter(dto: GenerateChapterDto) {
    const mode: 'novel' | 'microdrama' | 'film' = dto.mode === 'microdrama' ? 'microdrama' : dto.mode === 'film' ? 'film' : 'novel';
    const writerModelSelection = this.normalizeWriterModelSelection(dto);
    const unitLabel = mode === 'microdrama' ? '集' : mode === 'film' ? '节拍' : '章';
    const loopCount = Math.max(1, dto.unitCount ?? (mode === 'microdrama' || mode === 'film' ? 1 : 8));
    console.log(`开始循环生成${loopCount}${unitLabel}内容，使用模型: ${writerModelSelection.label}, 模式: ${mode}`);

    const startChapter = dto.chapterNumber;
    let fullContent = '';
    let contextMemory = dto.context; // 初始上下文
    let previousEnding = dto.previousEnding || '';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();

    try {
      for (let i = 0; i < loopCount; i++) {
        const currentChapterNum = startChapter + i;
        console.log(`正在生成第${currentChapterNum}${unitLabel}...`);

        const storyData = dto.savedMicroStories?.[currentChapterNum - 1];
        const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
	        const targetNovelWords = this.normalizeNovelTargetWords(dto.targetNovelWords);
	        const minNovelWords = Math.max(700, Math.round(targetNovelWords * 0.92));
	        const maxNovelWords = Math.min(3000, Math.round(targetNovelWords * 1.08));
	        const isLiteratureContext = contextMemory.includes('【文学作品正文模式】');
	        const firstNovelChapterSetupRequirement = currentChapterNum === 1 && !isLiteratureContext
	          ? `\n首章开场特别要求（必须执行）：\n- 第1章可以带着危机进入，但不能一开篇就只有生死、追杀、爆炸、濒死或抽象压迫。\n- 开篇前150-250字内，必须自然交代主角姓名/身份、所处时代或世界空间、当前阶层/家庭/职业处境，以及这个世界最关键的一条压力或规则。\n- 背景必须嵌入正在发生的事件中，通过场景、物件、旁人反应、制度规则、账单/考核/公告/禁令/身份牌等带出；不要停下来写设定说明书。\n- 危机要和主角身份、世界规则、人物欲望发生因果关系，让读者明白“他为什么会被逼到这一步”。\n`
	          : '';
	        const chapterPrompt = mode === 'microdrama'
	          ? this.buildMicrodramaEpisodePrompt(contextMemory, currentChapterNum, previousEnding, storyData, dto.actionFirstScript, dto.dialogueFirstScript, dto.targetEpisodeWords)
	          : mode === 'film'
	            ? this.buildFilmBeatPrompt(contextMemory, currentChapterNum, previousEnding, storyData, dto.targetNovelWords)
	          : isLiteratureContext
	            ? `${contextMemory}

请基于以上完整背景信息，生成当前文学作品小节正文。

${previousEnding ? `上一小节结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一小节最后一句（可自然承接，不必机械复写）：\n${previousLastSentence}\n\n` : ''}` : ''}

生成要求：
1. 标题使用当前小节标题或“第X章 第X小节”的格式，不要改成网文章节爽文标题。
2. 字数目标约 ${targetNovelWords} 字，允许 ${minNovelWords}-${maxNovelWords} 字之间自然浮动；以讲清本小节人物与事件为准。
3. 正常叙事，重视场景、人物动作、对话、沉默、心理细节、关系变化和生活质感。
4. 不要危机开头模板、不要打脸爽点、不要强钩子、不要系统/金手指/升级/神器宝物，不要刻意情绪拉扯。
5. 本小节是同一大章内部段落，只完成当前小节的叙事任务，结尾可以有余韵或自然过渡，不要硬造悬念。
6. 正文中不得出现“小故事卡”“技法卡”“一级结构”“阶段状态小结”等创作后台信息。

请直接输出正文。`
	            : `${contextMemory}

请基于以上完整的故事背景信息，生成第${currentChapterNum}章的内容。

${previousEnding ? `上一章结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一章最后一句（必须在本章开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}

感情线硬规则：
${romanceLineRules}
${firstNovelChapterSetupRequirement}

生成要求：
1. 章节标题要吸引人且符合故事风格，标题长度不超过8个字
2. 字数目标：本章目标约 ${targetNovelWords} 字，允许 ${minNovelWords}-${maxNovelWords} 字之间自然浮动；不要为了超过某个字数硬凑内容，抵达当前小故事结尾钩子后就收束
3. 内容要详细丰满，包含具体的场景描写、对话、心理活动和冲突
4. 保持与整体故事的连贯性和人物成长
5. 融入世界观设定和人物关系
6. 每章开头必须带着危机进入：承接上一章危机、抛出新威胁、制造关系爆雷、资源被夺、强敌压境或任务失败，不能平静开场
7. 推进过程中必须释放至少一个高燃点或爽点，例如反杀、打脸、破局、夺回资源、揭露真相、实力升级、情感爆发或关键选择
8. 章节结尾要为下一章留好铺垫，并自然融入悬念钩子，制造期待感，拉动读者继续阅读的欲望
9. **重要**：钩子要融入正文叙述中，作为故事发展的自然延伸，不要在文章结尾单独添加说明性句子
10. **衔接要求（关键）**：如果提供了“上一章结尾内容”，本章开头必须从该结尾**自然续写**（同一时空/同一动作/同一对话延续），不要用回顾式总结重述上一章；除非上一章结尾明确切换场景，否则开头至少连续推进300字后再转场。

请直接输出章节内容，格式如下：
第${currentChapterNum}章 [章节标题]

[章节正文内容，以约${targetNovelWords}字为目标]

注意：不要添加任何多余的说明或格式，直接从章节标题开始输出内容。`;

        // 使用用户选择的正文模型进行写作
	        const chapterResult = await this.llmService.chatWithWriterModel([
	          { role: 'system', content: this.getStoryWritingSystemPrompt() },
	          { role: 'user', content: chapterPrompt }
	        ], writerModelSelection.provider, writerModelSelection.model);

        console.log(`第${currentChapterNum}${unitLabel}生成成功，长度: ${chapterResult?.length || 0}`);

        // 添加到总内容中。网文必须先做小故事边界校验/裁剪，再判断是否仍需压缩。
        const validatedChapter = chapterResult
          ? await this.postProcessGeneratedChapter({
            content: chapterResult,
            chapterNumber: currentChapterNum,
            context: contextMemory,
            storyData,
            nextStoryData: dto.savedMicroStories?.[currentChapterNum],
            previousEnding,
            mode,
            writerModelProvider: writerModelSelection.provider,
            writerModel: writerModelSelection.model,
          })
          : '';

        if (validatedChapter) {
          fullContent += validatedChapter + '\n\n';
        }

        // 更新上下文记忆 - 只保留最近的剧情摘要，避免上下文过长
        if (validatedChapter) {
          // 提取“正文结尾锚点”作为下一章衔接参考（避免截到标题/空行）
          previousEnding = this.extractEndingForContinuity(validatedChapter);

          // 更新上下文记忆，保持总长度在合理范围内
          const recent = this.buildCompactChapterDigest(validatedChapter, currentChapterNum);
          contextMemory = `${dto.context.substring(0, 2000)}...\n\n最新剧情进展：\n${recent}`;
        }
      }

      console.log(`${loopCount}${unitLabel}内容生成完成，总长度: ${fullContent.length}`);

      return {
        success: true,
        data: fullContent.trim(),
      };
    } catch (error) {
      console.error('生成章节内容失败:', error);
      throw new Error('AI生成章节内容超时，请稍后重试');
    }
  }

  private buildNovelChapterPrompt(
    context: string,
    chapterNumber: number,
    previousEnding: string,
    targetNovelWords?: number,
    _chapterPosition: 'first' | 'second' | 'single' = 'single',
    _storyStartChapter?: number,
    _storyEndChapter?: number,
    nextExistingChapterNumber?: number,
    nextExistingChapterContent?: string,
	  ): string {
	    const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
	    const romanceLineRules = this.getRomanceLineHardRulesPrompt();
	    const isLiteratureContext = context.includes('【文学作品正文模式】');
	    const storyRange = `当前小故事只覆盖第${chapterNumber}章。`;
	    const firstNovelChapterSetupRequirement = chapterNumber === 1 && !isLiteratureContext
	      ? `\n首章开场特别要求（必须执行）：\n- 第1章可以带着危机进入，但不能一开篇就只有生死、追杀、爆炸、濒死或抽象压迫。\n- 开篇前150-250字内，必须自然交代主角姓名/身份、所处时代或世界空间、当前阶层/家庭/职业处境，以及这个世界最关键的一条压力或规则。\n- 背景必须嵌入正在发生的事件中，通过场景、物件、旁人反应、制度规则、账单/考核/公告/禁令/身份牌等带出；不要停下来写设定说明书。\n- 危机要和主角身份、世界规则、人物欲望发生因果关系，让读者明白“他为什么会被逼到这一步”。\n`
	      : '';
    const normalizedTargetWords = this.normalizeNovelTargetWords(targetNovelWords);
    const minTargetWords = Math.max(700, Math.round(normalizedTargetWords * 0.92));
    const maxTargetWords = Math.min(3000, Math.round(normalizedTargetWords * 1.08));
    const nextExistingReference = nextExistingChapterContent
      ? `后一章已生成内容开头（只作为本章结尾衔接参考，绝对不要复写后一章）：\n第${nextExistingChapterNumber || chapterNumber + 1}章开头节选：\n${nextExistingChapterContent}\n\n`
      : '';

	    if (isLiteratureContext) {
	      return `${context}

请基于以上完整背景信息，生成当前文学作品小节正文。

${previousEnding ? `上一小节结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一小节最后一句（可自然承接，不必机械复写）：\n${previousLastSentence}\n\n` : ''}` : ''}
${nextExistingReference}

文学正文限制：
- 当前任务只写当前小节，不能提前写后续小节。
- 不要网文化：禁止系统、金手指、外挂、升级、神器宝物、装逼打脸、强钩子、危机开头模板和过度情绪拉扯。
- 以所选文风为准，把故事讲清楚，把人物刻画到位，重视细节、关系变化、环境压力和主题余韵。
- 结尾可以自然留白或过渡，不要硬造悬念。
- ${this.getPlanningLeakRule()}

字数目标：约 ${normalizedTargetWords} 字，允许 ${minTargetWords}-${maxTargetWords} 字自然浮动。

请直接输出当前小节正文。`;
	    }

	    return `${context}

请基于以上完整的故事背景信息，生成第${chapterNumber}章的内容。

${previousEnding ? `上一章结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一章最后一句（必须在本章开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}
${nextExistingReference}

感情线硬规则：
${romanceLineRules}
${firstNovelChapterSetupRequirement}

**⚠️ 重要限制条件：**
- ${storyRange}
- 只生成第${chapterNumber}章，绝对不要生成第${chapterNumber + 1}章或其他章节。
- 必须严格遵循当前小故事剧情范围，不能偏离当前阶段规定的情节发展。
- 网文模式下每个小故事只对应一章；绝对不能涉及或暗示下一章/下一小故事的内容，确保每章都有独立的发展空间。
- 如果当前剧情范围与之前生成的内容有冲突，以当前剧情范围为准。
- 剧情边界优先于字数：一旦本章在当前小故事中的任务已经完成，必须立刻自然收束并停在钩子上，禁止为了凑字数继续写下一章、下一小故事或新增无关桥段。
- 本章必须完成当前章节细纲内的核心冲突推进，并在结尾留下下一章钩子；只留钩子，不要开始解决钩子。
- 如果提供了“后一章已生成内容开头”，本章结尾必须自然停在能承接后一章开头的位置；只搭桥，不要提前写后一章已经发生的具体内容。
- ${this.getPlanningLeakRule()}

生成要求：
1. 章节标题要吸引人且符合故事风格，标题长度不超过8个字。
2. 字数目标：本章以约 ${normalizedTargetWords} 字为目标，允许 ${minTargetWords}-${maxTargetWords} 字之间自然浮动；不要为了超过某个字数硬凑内容。若已经抵达当前小故事结尾钩子，必须停笔。
3. 内容要详细丰满，包含具体的场景描写、对话、心理活动、动作推进和冲突变化。
4. 保持与整体故事的连贯性和人物成长，特别要衔接好之前已生成的内容。
5. 融入世界观设定和人物关系。
6. 每章开头必须带着危机进入：承接上一章危机、抛出新威胁、制造关系爆雷、资源被夺、强敌压境或任务失败，不能平静开场。
7. 推进过程中必须释放至少一个高燃点或爽点，例如反杀、打脸、破局、夺回资源、揭露真相、实力升级、情感爆发或关键选择。
8. 章节结尾要为下一章留好铺垫，并自然融入悬念钩子，制造期待感，拉动读者继续阅读的欲望。
9. 钩子要融入正文叙述中，作为故事发展的自然延伸，不要在文章结尾单独添加说明性句子。
10. 衔接要求：如果提供了“上一章结尾内容”，本章开头必须从该结尾自然续写（同一时空/同一动作/同一对话延续），不要用回顾式总结重述上一章；除非上一章结尾明确切换场景，否则开头至少连续推进300-500字后再转场或跳时。
11. 反向衔接要求：如果后一章已经生成，本章结尾要给后一章开头留出合理入口，但不得复制、概述或提前解决后一章内容。

请直接输出章节内容，格式如下：
第${chapterNumber}章 [章节标题]

[第${chapterNumber}章正文内容，以当前剧情边界自然完成为准，目标约${normalizedTargetWords}字]

注意：不要添加任何多余的说明或格式，直接从章节标题开始输出内容。`;
  }

  async generateChapterStream(dto: GenerateChapterDto, requestId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`): Promise<Observable<any>> {
    const existingJob = this.generationStreamJobs.get(requestId);
    if (existingJob) {
      console.log(`接入已有流式生成任务: ${requestId}, 已缓存事件: ${existingJob.events.length}`);
      return this.getGenerationStreamObservable(existingJob);
    }

	    const mode: 'novel' | 'microdrama' | 'film' = dto.mode === 'microdrama' ? 'microdrama' : dto.mode === 'film' ? 'film' : 'novel';
	    const writerModelSelection = this.normalizeWriterModelSelection(dto);
    const unitLabel = mode === 'microdrama' ? '集' : mode === 'film' ? '节拍' : '章';
    const requestedUnitCount = Math.max(1, dto.unitCount ?? (mode === 'microdrama' || mode === 'film' ? 1 : 8));
    const loopCount = requestedUnitCount;
    const unitBatchSize = requestedUnitCount;
    const unitsPerStory = 1;
    const abortController = new AbortController();
    this.generationAbortControllers.set(requestId, abortController);
    const job = this.createGenerationStreamJob(requestId);
    const subscriber = {
      get closed() {
        return job.completed;
      },
      next: (event: GenerationStreamEvent) => this.publishGenerationStreamEvent(job, event),
      complete: () => this.finishGenerationStreamJob(job),
      error: (error: unknown) => this.finishGenerationStreamJob(job, error),
    } as Subscriber<GenerationStreamEvent>;

    const heartbeat = setInterval(() => {
      if (!subscriber.closed) {
        subscriber.next({ data: JSON.stringify({ type: 'ping', timestamp: Date.now() }) });
      }
    }, 15000);
    job.heartbeat = heartbeat;

      (async () => {
        try {
	          console.log(`开始流式生成${unitBatchSize}${unitLabel}内容，使用模型: ${writerModelSelection.label}, 请求ID: ${requestId}, 模式: ${mode}`);

          const startChapter = dto.chapterNumber;
          let contextMemory = dto.context;
          let previousEnding = dto.previousEnding || '';

          // 如果是生成后续批次，只提供前两个单位的内容作为参考，避免上下文过长
          if (startChapter >= 9 && dto.generatedChapters) {
            contextMemory += `\n\n【前两个${unitLabel}内容参考】\n`;
            // 只添加前两个单位的内容作为参考，避免上下文过长导致AI忽略小故事卡
            const referenceChapters = [1, 2];
            for (const chapterNum of referenceChapters) {
              if (dto.generatedChapters[chapterNum]) {
                const chapterContent = dto.generatedChapters[chapterNum];
                // 只保留标题和前500字符作为摘要，避免内容过长
                const lines = chapterContent.split('\n');
                const titleLine = lines.find(line => line.match(/^第\d+[章节集]\s*\[/));
                const summary = chapterContent.substring(0, 500) + (chapterContent.length > 500 ? '...' : '');
                contextMemory += `第${chapterNum}${unitLabel}${titleLine ? ` ${titleLine.split(' ').slice(1).join(' ')}` : ''}：\n${summary}\n\n`;
              }
            }
            contextMemory += `请基于以上前两个${unitLabel}的内容参考，继续创作后续${unitLabel}，确保故事的连贯性和人物成长的连续性。但必须严格遵循当前${mode === 'microdrama' ? '分集' : '小故事'}卡的内容，不得偏离。\n`;
          }

          // 发送开始信号
          subscriber.next({ data: JSON.stringify({ type: 'start', message: `开始生成${unitLabel}内容` }) });

          for (let storyIndex = 0; storyIndex < loopCount; storyIndex++) {
            // 检查是否被取消
            if (this.isCancelled(requestId)) {
              console.log(`生成请求 ${requestId} 已被用户取消`);
              subscriber.next({
                data: JSON.stringify({
                  type: 'cancelled',
                  message: '生成已被用户终止'
                })
              });
              subscriber.complete();
              clearInterval(heartbeat);
              this.clearGenerationRequest(requestId);
              return;
            }

            const storyStartChapter = startChapter + (storyIndex * unitsPerStory);
            const storyEndChapter = storyStartChapter;
            const currentStoryIndex = storyStartChapter - 1;
            const storyData = dto.savedMicroStories?.[currentStoryIndex];

            // 发送小故事开始信号
            subscriber.next({
              data: JSON.stringify({
                type: 'story_start',
                storyIndex: storyIndex + 1,
                chapters: [storyStartChapter],
                message: mode === 'microdrama'
                  ? `开始生成第${storyStartChapter}集`
                  : `开始生成第${storyStartChapter}章`
              })
            });

            console.log(mode === 'microdrama'
              ? `正在生成第${storyStartChapter}集...`
              : `正在生成第${storyStartChapter}章...`);

            // 构建包含当前小故事的上下文
            let storyContext = contextMemory;

            // 添加最近生成的小故事内容作为参考，避免上下文过长
            if (storyIndex > 0 && mode !== 'microdrama') {
              storyContext += `\n\n【最近生成内容参考】\n`;
              // 只包含最近1-2章对应的小故事内容作为参考，避免累积过多上下文
              const maxPrevStories = Math.min(storyIndex, 2); // 最多只参考最近2个小故事
              for (let i = 1; i <= maxPrevStories; i++) {
                const prevIndex = storyIndex - i;
                if (prevIndex >= 0) {
                  const prevStoryAbsoluteIndex = startChapter - 1 + prevIndex;
                  const prevStoryData = dto.savedMicroStories?.[prevStoryAbsoluteIndex];
                  if (prevStoryData) {
                    const prevStartChapter = startChapter + prevIndex;

                    storyContext += `\n【小故事${prevIndex + 1}（第${prevStartChapter}章）：${prevStoryData.title}】\n`;
                    storyContext += `内容概述：${prevStoryData.content.substring(0, 300)}...\n`; // 减少内容长度
                  }
                }
              }
              storyContext += `\n请确保新章节与以上最近生成的内容自然衔接，保持故事连贯性。但必须严格遵循当前剧情范围，不得偏离。\n`;
            }

            // 添加当前小故事的详细信息
            if (storyData) {
              storyContext += this.buildStoryBoundaryReference(storyData, mode === 'film' ? 'film' : 'novel');
            }

            if (mode !== 'microdrama') {
              try {
                const chapters: string[] = [];
                const chapterNum = storyStartChapter;
                if (this.isCancelled(requestId)) {
                    throw new Error('GENERATION_CANCELLED');
                }
                const chapterPrompt = mode === 'film'
                  ? this.buildFilmBeatPrompt(storyContext, chapterNum, previousEnding, storyData, dto.targetNovelWords)
                  : this.buildNovelChapterPrompt(
                    storyContext,
                    chapterNum,
                    previousEnding,
                    dto.targetNovelWords,
                    'single',
                    undefined,
                    undefined,
                    storyIndex === loopCount - 1 ? dto.nextExistingChapterNumber : undefined,
                    storyIndex === loopCount - 1 ? dto.nextExistingChapterContent : undefined,
                  );
                let chapterContent = '';
                const chunkPublisher = this.createThrottledStoryChunkPublisher(subscriber, {
                  storyIndex: storyIndex + 1,
                  chapter: chapterNum,
                });

                await this.llmService.chatWithWriterModelStream(
                  [
                    { role: 'system', content: this.getStoryWritingSystemPrompt() },
                    { role: 'user', content: chapterPrompt }
                  ],
                  (chunk: string) => {
                    chapterContent += chunk;
                    chunkPublisher.update(chapterContent);
                  },
                  writerModelSelection.provider,
                  writerModelSelection.model,
                  {
                    signal: abortController.signal,
                    isCancelled: () => this.isCancelled(requestId),
                  },
                );
                chunkPublisher.flush();

                const chapterStoryIndex = chapterNum - 1;
                const validatedChapter = chapterContent
                  ? await this.postProcessGeneratedChapter({
                    content: chapterContent,
                    chapterNumber: chapterNum,
                    context: storyContext,
                    storyData: dto.savedMicroStories?.[chapterStoryIndex] || storyData,
                    nextStoryData: dto.savedMicroStories?.[chapterStoryIndex + 1],
                    previousEnding,
                    mode,
                    writerModelProvider: writerModelSelection.provider,
                    writerModel: writerModelSelection.model,
                  })
                  : '';

                if (validatedChapter) {
                  chapters.push(validatedChapter);
                  previousEnding = this.extractEndingForContinuity(validatedChapter);

                  subscriber.next({
                    data: JSON.stringify({
                      type: 'chapter_complete',
                      chapter: chapterNum,
                      content: validatedChapter
                    })
                  });

                  console.log(`第${chapterNum}${unitLabel}生成完成，字数: ${this.getWordCount(validatedChapter)}`);
                }

                if (chapters.length > 0) {
                  const storyContent = chapters.join('\n\n');
                  subscriber.next({
                    data: JSON.stringify({
                      type: 'story_complete',
                      storyIndex: storyIndex + 1,
                      content: storyContent
                    })
                  });

                  const recentSummary = this.buildRecentSummaryForContext(chapters, storyStartChapter, storyStartChapter);
                  const maxContextLength = 3000;
                  if (contextMemory.length > maxContextLength) {
                    const baseContext = dto.context.substring(0, 1000);
                    contextMemory = baseContext + `\n\n最近生成内容：${recentSummary}...`;
                  } else {
                    contextMemory += `\n\n最新生成内容：${recentSummary}...`;
                  }

                  console.log(`第${chapterNum}${unitLabel}生成成功`);
                }
              } catch (storyError) {
                if (this.isCancelled(requestId) || abortController.signal.aborted || String((storyError as Error)?.message || '') === 'GENERATION_CANCELLED') {
                  console.log(`生成请求 ${requestId} 已在流式调用中终止`);
                  subscriber.next({
                    data: JSON.stringify({
                      type: 'cancelled',
                      message: '生成已被用户终止'
                    })
                  });
                  subscriber.complete();
                  clearInterval(heartbeat);
                  this.clearGenerationRequest(requestId);
                  return;
                }
                console.error(`第${storyIndex + 1}个小故事生成失败:`, storyError);
                subscriber.next({
                  data: JSON.stringify({
                    type: 'story_error',
                    storyIndex: storyIndex + 1,
                    error: `第${storyIndex + 1}个小故事生成失败`
                  })
                });
              }

              continue;
            }

            const storyPrompt = this.buildMicrodramaEpisodePrompt(storyContext, storyStartChapter, previousEnding, storyData, dto.actionFirstScript, dto.dialogueFirstScript, dto.targetEpisodeWords);

            try {
              let storyContent = '';
              const chunkPublisher = this.createThrottledStoryChunkPublisher(subscriber, {
                storyIndex: storyIndex + 1,
                chapter: storyStartChapter,
              });

              // 使用流式输出生成一个小故事
	              await this.llmService.chatWithWriterModelStream(
	                [
	                  { role: 'system', content: this.getStoryWritingSystemPrompt() },
	                  { role: 'user', content: storyPrompt }
	                ],
	                (chunk: string) => {
                  storyContent += chunk;
                  chunkPublisher.update(storyContent);
	                },
	                writerModelSelection.provider,
	                writerModelSelection.model,
                  {
                    signal: abortController.signal,
                    isCancelled: () => this.isCancelled(requestId),
                  },
	              );
              chunkPublisher.flush();

              if (storyContent) {
                // 发送小故事完成信号
                subscriber.next({
                  data: JSON.stringify({
                    type: 'story_complete',
                    storyIndex: storyIndex + 1,
                    content: storyContent
                  })
                });

                const rawChapters = [storyContent.trim()];
                const chapters: string[] = [];

                // 发送每个章节
                for (const [index, chapter] of rawChapters.entries()) {
                  const chapterNum = storyStartChapter + index;
                  const chapterStoryIndex = chapterNum - 1;
                  const validatedChapter = await this.validateAndTrimChapterScope({
                    content: chapter,
                    chapterNumber: chapterNum,
                    storyData: dto.savedMicroStories?.[chapterStoryIndex] || storyData,
                    nextStoryData: dto.savedMicroStories?.[chapterStoryIndex + 1],
                    mode,
                    writerModelProvider: writerModelSelection.provider,
                    writerModel: writerModelSelection.model,
                  });
                  chapters.push(validatedChapter);

                  subscriber.next({
                    data: JSON.stringify({
                      type: 'chapter_complete',
                      chapter: chapterNum,
                      content: validatedChapter
                    })
                  });

                  console.log(`第${chapterNum}${unitLabel}生成完成，字数: ${this.getWordCount(validatedChapter)}`);
                }

                // 更新上下文记忆
                const lastChapter = chapters[chapters.length - 1];
                previousEnding = this.extractEndingForContinuity(lastChapter);

                // 只保留最近2个小故事的上下文，避免累积过多内容
                const recentSummary = this.buildRecentSummaryForContext(chapters, storyStartChapter, storyEndChapter);
                // 控制上下文长度，如果超过一定长度则只保留最近的内容
                const maxContextLength = 3000; // 设置最大上下文长度
                if (contextMemory.length > maxContextLength) {
                  // 保留基础上下文和最近的生成内容
                  const baseContext = dto.context.substring(0, 1000); // 保留基础背景信息
                  contextMemory = baseContext + `\n\n最近生成内容：${recentSummary}...`;
                } else {
                  contextMemory += `\n\n最新生成内容：${recentSummary}...`;
                }

                console.log(mode === 'microdrama'
                  ? `第${storyStartChapter}集生成成功`
                  : `第${storyIndex + 1}个小故事生成成功，包含${chapters.length}个章节`);
              }
            } catch (storyError) {
              if (this.isCancelled(requestId) || abortController.signal.aborted || String((storyError as Error)?.message || '') === 'GENERATION_CANCELLED') {
                console.log(`生成请求 ${requestId} 已在流式调用中终止`);
                subscriber.next({
                  data: JSON.stringify({
                    type: 'cancelled',
                    message: '生成已被用户终止'
                  })
                });
                subscriber.complete();
                clearInterval(heartbeat);
                this.clearGenerationRequest(requestId);
                return;
              }
              console.error(`第${storyIndex + 1}个小故事生成失败:`, storyError);
              subscriber.next({
                data: JSON.stringify({
                  type: 'story_error',
                  storyIndex: storyIndex + 1,
                  error: `第${storyIndex + 1}个小故事生成失败`
                })
              });
              // 继续处理，不中断整个流程
            }
          }

          // 发送完成信号
          subscriber.next({
            data: JSON.stringify({
              type: 'complete',
              message: '所有章节生成完成'
            })
          });

          subscriber.complete();
          clearInterval(heartbeat);
          this.clearGenerationRequest(requestId);

        } catch (error) {
          console.error('流式生成失败:', error);
          clearInterval(heartbeat);
          this.clearGenerationRequest(requestId);
          subscriber.error(error);
        }
      })();

    return this.getGenerationStreamObservable(job);
  }

  async generateCharacterPrompts(dto: GenerateCharacterPromptsDto) {
    const episodes = (dto.episodes || [])
      .map(item => ({
        episode: Number(item?.episode),
        title: String(item?.title || '').trim(),
        outline: String(item?.outline || '').trim(),
        content: String(item?.content || '').trim(),
      }))
      .filter(item => Number.isFinite(item.episode) && item.episode > 0 && item.content)
      .sort((a, b) => a.episode - b.episode);

    if (!episodes.length) {
      throw new Error('没有可用于抓取人物的剧本正文');
    }

    const compact = (text?: string, limit = 4200) => {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}\n...[已截断]` : value;
    };

    const parseJson = (raw: string) => {
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('AI人物提示词结果不是有效JSON');
      }
    };

    const episodeBlock = episodes
      .map(item => `【第${item.episode}集${item.title ? `：${item.title}` : ''}】\n${item.outline ? `分集细纲：${item.outline}\n\n` : ''}剧本正文：\n${item.content}`)
      .join('\n\n---\n\n');
    const exampleBlock = (dto.promptExamples || [])
      .filter(Boolean)
      .slice(0, 4)
      .map((example, index) => `示例${index + 1}：${example}`)
      .join('\n\n');
    const existingAssetBlock = JSON.stringify({
      characters: (dto.existingCharacters || []).map((item: any) => ({
        name: item?.name,
        aliases: item?.aliases,
        episodeNumbers: item?.episodeNumbers,
        roleBrief: item?.roleBrief,
        hasImage: Boolean(item?.imageDataUrl || item?.imageUrl),
      })).slice(0, 120),
      scenes: (dto.existingScenes || []).map((item: any) => ({
        name: item?.name,
        episodeNumbers: item?.episodeNumbers || [item?.episodeNumber],
        sceneBrief: item?.sceneBrief,
        sceneType: item?.sceneType,
        hasImage: Boolean(item?.imageDataUrl || item?.imageUrl),
      })).slice(0, 120),
      props: (dto.existingProps || []).map((item: any) => ({
        name: item?.name,
        episodeNumbers: item?.episodeNumbers,
        propBrief: item?.propBrief,
        hasImage: Boolean(item?.imageDataUrl || item?.imageUrl),
      })).slice(0, 120),
    }, null, 2);

    const visualStyle = dto.visualStyle || 'live_action';
    const visualStyleRule = this.getAssetVisualStylePrompt(visualStyle);
    const prompt = `你是微短剧人物、场景、道具资产统筹和即梦提示词设计师。请从已生成的剧本正文中抓取出场人物，回到人设正文中匹配人物资料，并统计每一集出现的主要场景和关键道具，为人物、场景、道具生成可直接用于即梦的提示词。

【作品】
${dto.bookName || '未命名微短剧'}

【世界观摘要】
${compact(dto.worldSetting, 2600)}

【人物设定全文/摘要，必须优先检索匹配】
${compact(dto.characters, 6200)}

【全剧/中故事大纲摘要】
${compact(dto.detailedOutline, 3000)}

【本次选中的剧本正文】
${episodeBlock}

【已有资产库，必须用于去重和复用】
${existingAssetBlock}

【用户给出的提示词句型结构参考】
${exampleBlock || '无'}

${visualStyleRule}

${this.getCharacterPortraitPromptRule()}

抓取与匹配规则：
1. 先从剧本正文里抓取“本集实际出现或明确被点名、将用于镜头资产的人物”，包括主角、女主/男主、主要配角、反派、代理人、亲属、同事、侍卫、丫鬟、医生、警察、主持人等有姓名或明确身份称呼的角色。
2. 不要抓取纯背景群演，例如“众人、路人、保镖们、围观者”，除非剧本给了明确称呼、功能或镜头特写。
3. 对每个角色必须回到【人物设定】检索：能找到就标记 matchedFromCharacterSetting=true，并摘取最相关设定；找不到就标记 false，并根据本集剧情、身份称呼、行为和世界观补出合理人物概况。
4. 同一人物的别称要合并，例如“陆砚、陆大人、男主”只输出一次；但不同人物不能合并。
5. 每个人物提示词必须按用户示例的句子结构生成：画风定位 → 人物身份与体貌 → 面容神情 → 服装材质/剪裁/颜色 → 身份标志物或随身道具 → 中性定妆站姿与轻微可见细节 → 避免项或色调控制 → 全身照/正面/纯白背景/电影级质感。
6. 不要照抄示例的具体衣服、颜色、身高、饰品；必须根据该角色的人设、时代、职业、阶层、剧情功能和本集状态重新设计。
7. 龙套/配角也要能生成图：如果人设中没有外貌，就从身份、场景、性格和剧情作用补足“可拍的视觉特征”，但不要让所有人都华丽化。
8. 人物 prompt 字段必须是一段完整中文提示词，不要写成字段清单，不要出现“参考示例/模板/可替换”等说明。
9. 人物提示词是全剧通用定妆照，禁止受伤、血迹、破衣、战斗动作、哭喊、跪地、跌倒、奔跑、挥刀、拥抱、亲吻、被绑、被追杀等强情节化动作或临时状态。
10. 场景统计规则：每集提取1-4个主要场景，优先选择可复用的核心空间，例如大厅、院落、公司会议室、医院走廊、街巷、祠堂、审讯室、卧室、酒楼、祭坛等；如果有倒叙/回忆空间，标为 flashback。
11. 场景提示词默认生成“无人空镜”，不要出现具体人物、群演、背影或人脸；要写清时代、空间类型、布景、光线、气氛、关键道具和镜头构图。
12. 道具统计规则：每集提取0-4个会被镜头反复使用或影响剧情理解的关键道具，例如剑、玉佩、合同、手机、信物、账本、药瓶、车辆、首饰等；纯一次性普通杯子桌椅不要抓。
13. 已有资产库里已经存在的人物、场景或道具，不要重复改名生成新资产；如果同一资产在本集再次出现，只在返回的 episodeNumbers 中补充本集集数，并保持名字一致。

返回严格JSON，不要Markdown，不要解释：
{
  "visualStyle": "${visualStyle}",
  "characters": [
    {
      "name": "角色姓名或称呼",
      "aliases": ["别称1"],
      "episodeNumbers": [1],
      "appearanceLevel": "core|supporting|cameo",
      "matchedFromCharacterSetting": true,
      "matchConfidence": 0.92,
      "characterSettingExcerpt": "从人设检索到的关键资料；找不到则写空字符串",
      "plotBasis": "为什么判断这个人物在本集需要资产，引用本集剧情依据",
      "roleBrief": "一句话人物概况，包含身份、关系、性格或本集状态",
      "visualBrief": "一句话视觉设计依据",
      "prompt": "电影写实主义立绘，..."
    }
  ],
  "scenes": [
    {
      "name": "场景名",
      "episodeNumber": 1,
      "episodeNumbers": [1],
      "sceneType": "primary|secondary|flashback|transition",
      "plotBasis": "从本集剧情判断这个场景出现的依据",
      "sceneBrief": "一句话说明这是怎样的空间",
      "visualBrief": "场景视觉设计依据",
      "prompt": "无人空镜场景提示词"
    }
  ],
  "props": [
    {
      "name": "道具名",
      "episodeNumbers": [1],
      "propType": "weapon|token|document|jewelry|vehicle|daily|other",
      "reusable": true,
      "plotBasis": "从本集剧情判断这个道具需要资产的依据",
      "propBrief": "一句话说明这个道具是什么、谁持有、有什么剧情功能",
      "visualBrief": "道具视觉设计依据",
      "prompt": "单独道具图提示词，纯白背景，不要人物"
    }
  ],
  "summary": "本次抓取和匹配概要"
}`;

    const raw = await this.chatWithSelectedLogicModel([
      { role: 'system', content: '你只输出严格JSON。你擅长从剧本中抽取角色、匹配人物设定，并生成电影写实主义人物立绘提示词。' },
      { role: 'user', content: prompt },
    ], dto);
    const parsed = parseJson(raw);
    const characters = Array.isArray(parsed?.characters) ? parsed.characters : [];
    const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const props = Array.isArray(parsed?.props) ? parsed.props : [];

    return {
      success: true,
      data: {
        characters: characters.map((item: any, index: number) => ({
          id: String(item?.id || `${String(item?.name || '角色').trim() || '角色'}-${index}`),
          name: String(item?.name || '').trim() || `未命名角色${index + 1}`,
          aliases: Array.isArray(item?.aliases) ? item.aliases.map((alias: unknown) => String(alias || '').trim()).filter(Boolean) : [],
          episodeNumbers: Array.isArray(item?.episodeNumbers)
            ? item.episodeNumbers.map((episode: unknown) => Number(episode)).filter((episode: number) => Number.isFinite(episode))
            : episodes.map(item => item.episode),
          appearanceLevel: ['core', 'supporting', 'cameo'].includes(String(item?.appearanceLevel))
            ? String(item.appearanceLevel)
            : 'supporting',
          matchedFromCharacterSetting: Boolean(item?.matchedFromCharacterSetting),
          matchConfidence: Number.isFinite(Number(item?.matchConfidence)) ? Number(item.matchConfidence) : undefined,
          characterSettingExcerpt: String(item?.characterSettingExcerpt || '').trim(),
          plotBasis: String(item?.plotBasis || '').trim(),
          roleBrief: String(item?.roleBrief || '').trim(),
          visualBrief: String(item?.visualBrief || '').trim(),
          prompt: String(item?.prompt || '').trim(),
        })).filter((item: any) => item.name && item.prompt),
        scenes: scenes.map((item: any, index: number) => ({
          id: String(item?.id || `${String(item?.name || '场景').trim() || '场景'}-${index}`),
          name: String(item?.name || '').trim() || `未命名场景${index + 1}`,
          episodeNumber: Number.isFinite(Number(item?.episodeNumber)) ? Number(item.episodeNumber) : episodes[0]?.episode,
          episodeNumbers: Array.isArray(item?.episodeNumbers)
            ? item.episodeNumbers.map((episode: unknown) => Number(episode)).filter((episode: number) => Number.isFinite(episode))
            : [Number.isFinite(Number(item?.episodeNumber)) ? Number(item.episodeNumber) : episodes[0]?.episode],
          sceneType: ['primary', 'secondary', 'flashback', 'transition'].includes(String(item?.sceneType))
            ? String(item.sceneType)
            : 'primary',
          plotBasis: String(item?.plotBasis || '').trim(),
          sceneBrief: String(item?.sceneBrief || '').trim(),
          visualBrief: String(item?.visualBrief || '').trim(),
          prompt: String(item?.prompt || '').trim(),
        })).filter((item: any) => item.name && item.prompt),
        props: props.map((item: any, index: number) => ({
          id: String(item?.id || `${String(item?.name || '道具').trim() || '道具'}-${index}`),
          name: String(item?.name || '').trim() || `未命名道具${index + 1}`,
          episodeNumbers: Array.isArray(item?.episodeNumbers)
            ? item.episodeNumbers.map((episode: unknown) => Number(episode)).filter((episode: number) => Number.isFinite(episode))
            : episodes.map(item => item.episode),
          propType: ['weapon', 'token', 'document', 'jewelry', 'vehicle', 'daily', 'other'].includes(String(item?.propType))
            ? String(item.propType)
            : 'other',
          reusable: Boolean(item?.reusable ?? true),
          plotBasis: String(item?.plotBasis || '').trim(),
          propBrief: String(item?.propBrief || '').trim(),
          visualBrief: String(item?.visualBrief || '').trim(),
          prompt: String(item?.prompt || '').trim(),
        })).filter((item: any) => item.name && item.prompt),
        visualStyle,
        summary: String(parsed?.summary || `已从${episodes.length}集剧本中生成人物、场景和道具提示词。`).trim(),
      },
    };
  }

  async reviseCharacterPrompt(dto: ReviseCharacterPromptDto) {
    const character = dto.character || {};
    const note = String(dto.note || '').trim();
    if (!String(character?.name || '').trim()) {
      throw new Error('缺少要处理的人物');
    }
    if (!note) {
      throw new Error('请填写备注后再重新生成或微调提示词');
    }

    const parseJson = (raw: string) => {
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('AI人物提示词微调结果不是有效JSON');
      }
    };
    const compact = (text?: string, limit = 3600) => {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}\n...[已截断]` : value;
    };
    const exampleBlock = (dto.promptExamples || [])
      .filter(Boolean)
      .slice(0, 4)
      .map((example, index) => `示例${index + 1}：${example}`)
      .join('\n\n');
    const visualStyleRule = this.getAssetVisualStylePrompt(dto.visualStyle || 'live_action');

    const prompt = `你是即梦人物立绘提示词修订师。请根据用户备注，对单个人物的立绘提示词进行${dto.action === 'regenerate' ? '重新生成' : '微调'}。

【世界观摘要】
${compact(dto.worldSetting, 2200)}

【人物设定摘要】
${compact(dto.characters, 3600)}

【全剧/中故事大纲摘要】
${compact(dto.detailedOutline, 2200)}

【当前人物资料】
${JSON.stringify(character, null, 2)}

【当前已有提示词】
${String(character?.prompt || '')}

【用户备注】
${note}

【用户给出的提示词句型结构参考】
${exampleBlock || '无'}

${visualStyleRule}

${this.getCharacterPortraitPromptRule()}

修订要求：
1. 如果 action=regenerate：允许重做服装、气质、道具和姿态，但必须保留人物身份、剧情功能和人设核心。
2. 如果 action=tune：尽量保留原提示词主体，只根据用户备注精修局部，如年龄感、服装颜色、气质、身份道具、姿态、妆发或复杂度。
3. 不要照抄示例具体服装和颜色；必须根据这个人物重新生成。
4. prompt 必须是一段完整中文提示词，遵守当前视觉模式、全身照、正面、纯白背景、电影级质感。
5. 这是全剧通用定妆照，禁止受伤、血迹、破衣、战斗动作、哭喊、跪地、跌倒、奔跑、挥刀、拥抱、亲吻、被绑、被追杀等强情节化动作或临时状态。

返回严格JSON，不要Markdown，不要解释：
{
  "character": {
    "name": "角色名",
    "aliases": [],
    "episodeNumbers": [],
    "appearanceLevel": "core|supporting|cameo",
    "matchedFromCharacterSetting": true,
    "matchConfidence": 0.9,
    "characterSettingExcerpt": "保留或更新",
    "plotBasis": "保留或更新",
    "roleBrief": "保留或更新",
    "visualBrief": "根据备注更新后的视觉依据",
    "promptNote": "本次备注",
    "prompt": "修订后的完整即梦提示词"
  }
}`;

    const raw = await this.chatWithSelectedLogicModel([
      { role: 'system', content: '你只输出严格JSON。你擅长按用户备注重生成或微调单个人物的电影写实主义立绘提示词。' },
      { role: 'user', content: prompt },
    ], dto);
    const parsed = parseJson(raw);
    const next = parsed?.character || {};

    return {
      success: true,
      data: {
        ...character,
        ...next,
        name: String(next?.name || character?.name || '').trim(),
        aliases: Array.isArray(next?.aliases) ? next.aliases : (Array.isArray(character?.aliases) ? character.aliases : []),
        episodeNumbers: Array.isArray(next?.episodeNumbers) ? next.episodeNumbers : (Array.isArray(character?.episodeNumbers) ? character.episodeNumbers : []),
        appearanceLevel: ['core', 'supporting', 'cameo'].includes(String(next?.appearanceLevel))
          ? String(next.appearanceLevel)
          : (['core', 'supporting', 'cameo'].includes(String(character?.appearanceLevel)) ? String(character.appearanceLevel) : 'supporting'),
        matchedFromCharacterSetting: Boolean(next?.matchedFromCharacterSetting ?? character?.matchedFromCharacterSetting),
        promptNote: String(next?.promptNote || note).trim(),
        prompt: String(next?.prompt || character?.prompt || '').trim(),
      },
    };
  }

  async generateSupplementalAssetPrompt(dto: GenerateSupplementalAssetPromptDto) {
    const note = String(dto.note || '').trim();
    if (!note) {
      throw new Error('请填写补充设定后再生成');
    }
    const episode = {
      episode: Number(dto.episode?.episode),
      title: String(dto.episode?.title || '').trim(),
      outline: String(dto.episode?.outline || '').trim(),
      content: String(dto.episode?.content || '').trim(),
    };
    if (!Number.isFinite(episode.episode) || !episode.content) {
      throw new Error('缺少可参考的本集正文');
    }

    const parseJson = (raw: string) => {
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('AI补充资产结果不是有效JSON');
      }
    };
    const compact = (text?: string, limit = 3200) => {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}\n...[已截断]` : value;
    };
    const exampleBlock = (dto.promptExamples || [])
      .filter(Boolean)
      .slice(0, 4)
      .map((example, index) => `示例${index + 1}：${example}`)
      .join('\n\n');
    const visualStyleRule = this.getAssetVisualStylePrompt(dto.visualStyle);
    const targetSchema = dto.assetType === 'character'
      ? `"character": {
    "name": "人物姓名或称呼",
    "aliases": [],
    "episodeNumbers": [${episode.episode}],
    "appearanceLevel": "core|supporting|cameo",
    "matchedFromCharacterSetting": false,
    "matchConfidence": 0.5,
    "characterSettingExcerpt": "",
    "plotBasis": "根据本集正文和用户备注生成的依据",
    "roleBrief": "一句话人物概况",
    "visualBrief": "视觉设计依据",
    "promptNote": "用户补充设定",
    "prompt": "完整人物定妆照提示词"
  }`
      : dto.assetType === 'scene'
      ? `"scene": {
    "name": "场景名",
    "episodeNumber": ${episode.episode},
    "episodeNumbers": [${episode.episode}],
    "sceneType": "${dto.noPeople ? 'flashback' : 'primary'}",
    "plotBasis": "根据本集正文和用户备注生成的依据",
    "sceneBrief": "一句话说明这是怎样的空间",
    "visualBrief": "视觉设计依据",
    "promptNote": "用户补充设定",
    "prompt": "完整场景空镜提示词"
  }`
      : `"prop": {
    "name": "道具名",
    "episodeNumbers": [${episode.episode}],
    "propType": "weapon|token|document|jewelry|vehicle|daily|other",
    "reusable": true,
    "plotBasis": "根据本集正文和用户备注生成的依据",
    "propBrief": "一句话说明这个道具是什么、谁持有、有什么剧情功能",
    "visualBrief": "视觉设计依据",
    "promptNote": "用户补充设定",
    "prompt": "完整独立道具图提示词，纯白背景，不要人物"
  }`;

    const prompt = `你是微短剧资产补充生成师。请根据用户补充设定和当前集正文，额外生成一个${dto.assetType === 'character' ? '人物定妆照提示词' : dto.assetType === 'scene' ? '场景提示词' : '道具提示词'}。

【当前集】
第${episode.episode}集${episode.title ? `：${episode.title}` : ''}

【分集细纲】
${episode.outline || '无'}

【本集正文】
${episode.content}

【世界观摘要】
${compact(dto.worldSetting, 2200)}

【人物设定摘要】
${compact(dto.characters, 2600)}

【全剧/中故事大纲摘要】
${compact(dto.detailedOutline, 1800)}

【用户补充设定】
${note}

【用户给出的提示词句型结构参考】
${exampleBlock || '无'}

${visualStyleRule}

${this.getCharacterPortraitPromptRule()}

生成要求：
1. 如果生成角色：根据本集内容和用户备注补出一个可全剧复用的人物定妆照，不要写受伤、血迹、战斗动作或强剧情瞬间。
2. 如果生成场景：生成无人空镜，不要出现人物、群演、背影或人脸；如果用户要求倒叙/回忆，只生成倒叙场景本身，不要出现人物。
3. 如果生成道具：生成独立道具图，纯白背景或干净展示台，不要出现人物和手部；道具要适合后续视频镜头反复引用。
4. 严格遵守当前视觉模式，不要混用真人和动漫风格。
5. prompt 必须是一段完整中文提示词，不要写字段清单或解释。

返回严格JSON，不要Markdown，不要解释：
{
  ${targetSchema}
}`;

    const raw = await this.chatWithSelectedLogicModel([
      { role: 'system', content: '你只输出严格JSON。你擅长按用户补充设定生成微短剧人物或场景资产提示词。' },
      { role: 'user', content: prompt },
    ], dto);
    const parsed = parseJson(raw);
    if (dto.assetType === 'character') {
      const item = parsed?.character || {};
      return {
        success: true,
        data: {
          character: {
            id: String(item?.id || `${String(item?.name || '角色').trim() || '角色'}-${Date.now()}`),
            name: String(item?.name || '').trim() || '补充人物',
            aliases: Array.isArray(item?.aliases) ? item.aliases : [],
            episodeNumbers: Array.isArray(item?.episodeNumbers) ? item.episodeNumbers : [episode.episode],
            appearanceLevel: ['core', 'supporting', 'cameo'].includes(String(item?.appearanceLevel)) ? String(item.appearanceLevel) : 'supporting',
            matchedFromCharacterSetting: Boolean(item?.matchedFromCharacterSetting),
            matchConfidence: Number.isFinite(Number(item?.matchConfidence)) ? Number(item.matchConfidence) : undefined,
            characterSettingExcerpt: String(item?.characterSettingExcerpt || '').trim(),
            plotBasis: String(item?.plotBasis || '').trim(),
            roleBrief: String(item?.roleBrief || '').trim(),
            visualBrief: String(item?.visualBrief || '').trim(),
            promptNote: String(item?.promptNote || note).trim(),
            prompt: String(item?.prompt || '').trim(),
          },
        },
      };
    }

    if (dto.assetType === 'prop') {
      const item = parsed?.prop || {};
      return {
        success: true,
        data: {
          prop: {
            id: String(item?.id || `${String(item?.name || '道具').trim() || '道具'}-${Date.now()}`),
            name: String(item?.name || '').trim() || '补充道具',
            episodeNumbers: Array.isArray(item?.episodeNumbers) ? item.episodeNumbers : [episode.episode],
            propType: ['weapon', 'token', 'document', 'jewelry', 'vehicle', 'daily', 'other'].includes(String(item?.propType)) ? String(item.propType) : 'other',
            reusable: Boolean(item?.reusable ?? true),
            plotBasis: String(item?.plotBasis || '').trim(),
            propBrief: String(item?.propBrief || '').trim(),
            visualBrief: String(item?.visualBrief || '').trim(),
            promptNote: String(item?.promptNote || note).trim(),
            prompt: String(item?.prompt || '').trim(),
          },
        },
      };
    }

    const item = parsed?.scene || {};
    return {
      success: true,
      data: {
        scene: {
          id: String(item?.id || `${String(item?.name || '场景').trim() || '场景'}-${Date.now()}`),
          name: String(item?.name || '').trim() || '补充场景',
          episodeNumber: Number.isFinite(Number(item?.episodeNumber)) ? Number(item.episodeNumber) : episode.episode,
          episodeNumbers: Array.isArray(item?.episodeNumbers) ? item.episodeNumbers : [episode.episode],
          sceneType: ['primary', 'secondary', 'flashback', 'transition'].includes(String(item?.sceneType)) ? String(item.sceneType) : (dto.noPeople ? 'flashback' : 'primary'),
          plotBasis: String(item?.plotBasis || '').trim(),
          sceneBrief: String(item?.sceneBrief || '').trim(),
          visualBrief: String(item?.visualBrief || '').trim(),
          promptNote: String(item?.promptNote || note).trim(),
          prompt: String(item?.prompt || '').trim(),
        },
      },
    };
  }

  async generateSeedancePrompts(dto: GenerateSeedancePromptsDto) {
    const episode = {
      episode: Number(dto.episode?.episode),
      title: String(dto.episode?.title || '').trim(),
      outline: String(dto.episode?.outline || '').trim(),
      content: String(dto.episode?.content || '').trim(),
    };
    if (!Number.isFinite(episode.episode) || !episode.content) {
      throw new Error('缺少可拆解的本集正文');
    }

    const parseJson = (raw: string) => {
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('AI SeeDance提示词结果不是有效JSON');
      }
    };
    const compact = (text?: string, limit = 3600) => {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}\n...[已截断]` : value;
    };
    const visualStyleMap: Record<string, string> = {
      live_action: '真人微短剧，电影写实主义，无背景音乐，电影级光影，画面细节丰富，无字幕',
      guofeng_2d: '2D国风动漫风格，无背景音乐，电影级光影，画面细节丰富，无字幕',
      guofeng_3d: '3D国风动漫风格，无背景音乐，电影级光影，画面细节丰富，无字幕',
    };
    const withAtLabel = (label: string) => {
      const value = String(label || '').trim();
      return value ? (value.startsWith('@') ? value : `@${value}`) : '';
    };
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizeSeedanceAssetRefs = (text: string) => {
      let next = String(text || '');
      for (const asset of [...assets].sort((a, b) => b.label.length - a.label.length)) {
        const label = asset.label;
        const bare = label.replace(/^@/, '');
        if (!bare) continue;
        next = next.replace(new RegExp(`(?<!@)${escapeRegExp(bare)}`, 'g'), label);
        if (bare.startsWith('图')) {
          next = next.replace(new RegExp(`(?<!@)${escapeRegExp(`图片${bare.slice(1)}`)}`, 'g'), label);
        }
      }
      return next;
    };
    const assets = (dto.assets || []).map((item: any) => ({
      label: withAtLabel(item?.label),
      assetType: String(item?.assetType || '').trim(),
      name: String(item?.name || '').trim(),
      brief: String(item?.brief || '').trim(),
      prompt: String(item?.prompt || '').trim(),
    })).filter(item => item.label && item.name);
    const targetSegmentCount = Math.min(10, Math.max(6, Number(dto.targetSegmentCount || 8)));
    const shotsPerSegment = Math.min(7, Math.max(5, Number(dto.shotsPerSegment || 5)));

    const prompt = `你是SeeDance视频提示词拆解师。请把微短剧单集正文拆成适合短视频生成的分段提示词。

【本集】
第${episode.episode}集${episode.title ? `：${episode.title}` : ''}

【分集细纲】
${episode.outline || '无'}

【本集正文】
${episode.content}

【世界观摘要】
${compact(dto.worldSetting, 1800)}

【人物设定摘要】
${compact(dto.characters, 2200)}

【全剧/中故事大纲摘要】
${compact(dto.detailedOutline, 1800)}

【本集可引用资产，必须按@图号引用】
${JSON.stringify(assets, null, 2)}

【用户给出的格式参考】
${dto.promptExample || '无'}

生成规则：
1. 根据本集实际内容输出6-10段，优先约${targetSegmentCount}段；每段约15秒，原则上每段${shotsPerSegment}个镜头，如果总段数只有6段，每段必须扩到6-7个镜头来承接更多剧情。
2. 每段 prompt 的第一句必须包含当前风格基础：${visualStyleMap[dto.visualStyle] || visualStyleMap.live_action}。
3. 资产引用必须使用“@图一、@图二、@图三”这种格式，图号前必须带@符号；不要写成“图一/图片一”，也不要写人物原名作为图片引用；如果资产库没有对应@图号，才用文字描述。
4. 每段必须像用户示例一样写“第一个镜头、第二个镜头……”；每个镜头都要有景别、构图位置、动作节奏、人物/场景/道具@图号、情绪、镜头运动、环境细节，不能只写一句概括。
5. 镜头调度必须专业：明确人物关系和空间关系，例如谁在前景压迫、谁在后景观察、谁越过谁的肩膀看向目标、谁被人群隔开；通过站位、视线、反应镜头、遮挡、推拉摇移、环绕、跟拍、甩镜、低机位仰拍、快速推近等方式表现权力关系和情绪变化。
6. 该炫酷的地方要有炫酷运镜，但不能乱炫：反转、登场、赌局/审判/追逐/威胁/揭露身份/能力发动等节点，可以使用快速推轨、环绕定格、俯冲、横移穿越人群、慢动作接特写、道具特写转场；普通对话段用稳定的正反打、过肩、反应镜头和轻微推近。
7. 台词密度要适当增大，用来把单集故事情节讲清楚，但不能机械堆字。每段通常安排2-4句自然短台词、旁白或人物OS；信息爆发段可到4-6句。台词必须服务情节：交代身份、关系、规则、目标、风险、选择、误会、反转或情绪递进。
8. 第1段和第2段必须承担开场交代：在剧本框架内，用冲突中的对话、旁白OS和环境信息讲清楚主角是谁、这是怎样的世界、当前危险或规则是什么、各方在争什么、人物关系为什么紧张。不要突兀科普，不要像说明书。
9. 台词必须口语化、可表演，符合人物身份和关系：熟人可以省略称呼、带情绪停顿；上位者压迫要短促克制；主角OS可以清楚但不装腔。禁止网文腔、口号腔、鸡皮疙瘩式狠话、过度中二表达。
10. 每段需要把剧情内容展开交代清楚：如果这一段只有动作没有信息，就补人物反应或一句OS；如果只有解释没有戏，就用对手打断、旁人质疑、道具变化或镜头压迫把信息戏剧化。
11. 仍然要保证15秒能念完：台词多的段落减少动作复杂度；动作强的段落减少台词，用短句和反应镜头承接信息。
12. 禁止字幕、禁止背景音乐；人物身上默认干净，不要随意写污渍、血迹、受伤，除非原文这一段必须表达。
13. 风格要符合本集调性和资产模式；真人模式写写实摄影，2D/3D动漫模式写对应动漫风格。
14. 不要写解释、教程、分镜理论，只写可直接复制到SeeDance的提示词。每段 prompt 必须把台词写进镜头描述里，例如：他说：“短台词。” 或 旁白OS：“短旁白。”

返回严格JSON，不要Markdown，不要解释：
{
  "segments": [
    {
      "index": 1,
      "title": "这一段剧情小标题",
      "scriptRange": "对应原文大致范围",
      "assetRefs": ["@图一", "@图二"],
      "prompt": "2D动漫风格，无背景音乐，电影级光影，@图一..."
    }
  ],
  "summary": "拆解概要"
}`;

    const raw = await this.chatWithSelectedLogicModel([
      { role: 'system', content: '你只输出严格JSON。你擅长把微短剧正文拆成SeeDance十五秒视频提示词，尤其擅长专业影视调度、人物关系调度、炫酷但有动机的运镜，以及口语化但信息密度足够的台词和人物OS。' },
      { role: 'user', content: prompt },
    ], dto);
    const parsed = parseJson(raw);
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    return {
      success: true,
      data: {
        segments: segments.map((item: any, index: number) => ({
          index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index + 1,
          title: String(item?.title || `第${index + 1}段`).trim(),
          scriptRange: String(item?.scriptRange || '').trim(),
          assetRefs: Array.isArray(item?.assetRefs) ? item.assetRefs.map((ref: unknown) => withAtLabel(String(ref || '').trim())).filter(Boolean) : [],
          prompt: normalizeSeedanceAssetRefs(String(item?.prompt || '').trim()),
        })).filter((item: any) => item.prompt),
        summary: String(parsed?.summary || `已拆解第${episode.episode}集SeeDance提示词。`).trim(),
      },
    };
  }

  async reviewMicrodramaScripts(dto: ReviewMicrodramaScriptsDto) {
    const entries = Object.entries(dto.chapters || {})
      .map(([episode, content]) => ({ episode: Number(episode), content: String(content || '') }))
      .filter(item => Number.isFinite(item.episode) && item.content.trim())
      .sort((a, b) => a.episode - b.episode);

    if (!entries.length) {
      throw new Error('没有可审读的微短剧剧本正文');
    }

    const chunkSize = 5;
    const updatedChapters: Record<number, string> = Object.fromEntries(entries.map(item => [item.episode, item.content]));
    const allIssues: Array<Record<string, unknown>> = [];
    const appliedPatches: Array<Record<string, unknown>> = [];
    const skippedPatches: Array<Record<string, unknown>> = [];
    const compressedEpisodes: Array<Record<string, unknown>> = [];
    const model = dto.model?.trim() || 'gpt-5.5';

    const parseJson = (raw: string) => {
      const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('AI审读结果不是有效JSON');
      }
    };

    const compact = (text?: string, limit = 3500) => {
      const value = String(text || '').trim();
      return value.length > limit ? `${value.slice(0, limit)}\n...[已截断]` : value;
    };

    for (let index = 0; index < entries.length; index += chunkSize) {
      const chunk = entries.slice(index, index + chunkSize);
      const previous = entries[index - 1];
      const next = entries[index + chunk.length];
      const episodeNumbers = chunk.map(item => item.episode);
      const microStoryRefs = (dto.savedMicroStories || [])
        .filter((story: any, storyIndex: number) => {
          const order = Number(story?.order || storyIndex + 1);
          return episodeNumbers.includes(order);
        })
        .map((story: any, storyIndex: number) => `第${story?.order || storyIndex + 1}集细纲：${story?.title || ''}\n${String(story?.content || '').slice(0, 900)}`)
        .join('\n\n');

      const scriptBlock = chunk
        .map(item => `【第${item.episode}集当前剧本】\n${item.content}`)
        .join('\n\n');

      const prompt = `你是微短剧剧本总审读与台词修订师。请对下面这批已写好的微短剧剧本做“补丁式修订”，不要整集重写。

【世界观摘要】
${compact(dto.worldSetting, 2200)}

【人物设定摘要】
${compact(dto.characters, 3200)}

【全剧/中故事大纲摘要】
${compact(dto.detailedOutline, 2600)}

【本批分集细纲】
${microStoryRefs || '无'}

${previous ? `【上一集结尾参考】\n第${previous.episode}集结尾：${previous.content.slice(-500)}\n` : ''}
${next ? `【下一集细纲/衔接参考】\n第${next.episode}集标题或正文开端：${next.content.slice(0, 500)}\n` : ''}

【待审读剧本】
${scriptBlock}

审读与修订重点：
1. 剧情一致性：人物已知信息、身份、关系、上一集结尾、下一集承接不能矛盾。
2. 微短剧节奏：每集开头要抓人，中段推进快，结尾有钩子；删掉重复解释和无效闲聊。
3. 人物弧光：主角、主要配角、主反派/核心压力源的选择、代价、关系变化要连续。
4. 反派贯穿：主反派或核心压力源不能断线；即便本人不出场，也要通过代理人、证据、资源封锁、舆论、旧账或关系操控产生压力。
5. 台词专项，这是最高优先级之一：
   - 主角台词必须符合人设，有记忆点、有态度、有价值观，可以形成金句；不能像普通说明文字。
   - 主要配角台词要能听出身份、欲望、恐惧、口癖或利益立场，不能所有人一个腔调。
   - 反派/压力方台词要有压迫感、诱惑性或自我辩护，不能只会放狠话。
   - 爱情线台词要有试探、调侃、护短、吃醋、误会或暧昧张力，但必须推动关系变化。
   - 台词必须去除过度网文化、霸总腔、尬爽宣言、鸡皮疙瘩式土味情话和端着说教；优先改成真实口语、潜台词、停顿、反问、回避、情绪错位和行动后的短句。
   - 如果原台词只表达“拜金、自私、我恨你、我要报复”这类单一动机，必须补成更复杂的人性逻辑：生存压力、羞耻、亏欠、恐惧、保护欲、自我辩护或成长挣扎。
6. 可拍摄性：不要把单集改厚，优先替换一小段、一组对白或一处动作说明。
7. 只返回需要修改的地方。没有问题的段落不要返回补丁。

返回严格JSON，不要Markdown，不要解释：
{
  "issues": [
    {"episode": 1, "type": "dialogue|continuity|pacing|character_arc|villain_thread|format|review_risk", "severity": "high|medium|low", "problem": "问题说明"}
  ],
  "patches": [
    {
      "episode": 1,
      "type": "dialogue|continuity|pacing|character_arc|villain_thread|format|review_risk",
      "reason": "为什么这样改",
      "findText": "原文中需要替换的一小段，必须逐字摘录，长度控制在20-600字",
      "replaceText": "替换后的新文本，保留剧本格式，尤其优先打磨主角和主要配角台词"
    }
  ],
  "summary": "本批修订概要"
}`;

      const raw = await this.llmService.chatWithGatewayModel([
        { role: 'system', content: '你只输出严格JSON。你擅长微短剧剧本一致性审读、补丁式修订和高记忆点台词打磨。' },
        { role: 'user', content: prompt },
      ], model);
      const parsed = parseJson(raw);
      const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
      const patches = Array.isArray(parsed?.patches) ? parsed.patches : [];
      allIssues.push(...issues);

      for (const patch of patches) {
        const episode = Number(patch?.episode);
        const findText = String(patch?.findText || '').trim();
        const replaceText = String(patch?.replaceText || '').trim();
        if (!Number.isFinite(episode) || !findText || !replaceText || !updatedChapters[episode]) {
          skippedPatches.push({ ...patch, skipReason: '补丁字段不完整或集数不存在' });
          continue;
        }
        if (!updatedChapters[episode].includes(findText)) {
          skippedPatches.push({ ...patch, skipReason: '未找到可安全替换的原文片段' });
          continue;
        }
        updatedChapters[episode] = updatedChapters[episode].replace(findText, replaceText);
        appliedPatches.push({
          episode,
          type: patch?.type || 'dialogue',
          reason: patch?.reason || '',
          beforeWords: this.getWordCount(findText),
          afterWords: this.getWordCount(replaceText),
        });
      }
    }

    for (const [episodeText, content] of Object.entries(updatedChapters)) {
      const episode = Number(episodeText);
      const currentWords = this.getWordCount(content);
      if (!Number.isFinite(episode) || currentWords <= 1500) continue;

      const storyData = (dto.savedMicroStories || []).find((story: any, index: number) => {
        const order = Number(story?.order || index + 1);
        return order === episode;
      });
      const prompt = `请把下面这集微短剧剧本压缩到约1200字，允许1100-1300字之间浮动。

【本集分集细纲】
${storyData ? `标题：${storyData.title || ''}\n内容：${String(storyData.content || '').slice(0, 1200)}` : '无'}

【当前第${episode}集剧本，约${currentWords}字】
${content}

压缩要求：
1. 必须输出完整的第${episode}集剧本，不要输出说明、清单或差异。
2. 保留核心剧情节点、开场危机、关键反转/爽点、人物弧线推进、爱情线有效互动和集尾钩子。
3. 保留已经打磨出的主角金句、主要配角身份化台词、反派压迫感台词；如果必须删减台词，优先删重复解释和普通寒暄。
4. 压缩方式：合并重复动作、删掉解释性对白、减少场景铺陈、压缩不影响剧情的镜头说明；不要删掉导致前后不连贯。
5. 仍然保持标准微短剧拍摄剧本格式：场号、人物、动作/镜头说明、角色对白清楚。
6. 不要提前写下一集内容，不要改变本集结尾钩子。

请直接输出压缩后的第${episode}集剧本。`;

      try {
        const compressed = await this.llmService.chatWithGatewayModel([
          { role: 'system', content: '你是微短剧剧本压缩师，擅长在不损失戏剧质量、人物弧光和台词记忆点的前提下压缩篇幅。' },
          { role: 'user', content: prompt },
        ], model);
        const cleaned = String(compressed || '').trim();
        if (cleaned) {
          const nextWords = this.getWordCount(cleaned);
          updatedChapters[episode] = cleaned;
          compressedEpisodes.push({
            episode,
            beforeWords: currentWords,
            afterWords: nextWords,
          });
        }
      } catch (error) {
        console.error(`第${episode}集剧本压缩失败:`, error);
        skippedPatches.push({
          episode,
          type: 'length_compression',
          skipReason: `第${episode}集超过1500字，自动压缩失败，保留审读修订后的原文`,
        });
      }
    }

    return {
      success: true,
      data: {
        updatedChapters,
        issues: allIssues,
        appliedPatches,
        skippedPatches,
        compressedEpisodes,
        summary: `完成${entries.length}集微短剧审读，应用${appliedPatches.length}处补丁，压缩${compressedEpisodes.length}集超长剧本，跳过${skippedPatches.length}处需人工确认补丁。`,
      },
    };
  }

  async rewriteChapter(dto: RewriteChapterDto) {
    const writerModelSelection = this.normalizeWriterModelSelection(dto);
    const mode: 'novel' | 'microdrama' | 'film' = dto.mode === 'microdrama' ? 'microdrama' : dto.mode === 'film' ? 'film' : 'novel';
    const currentWords = this.getWordCount(dto.content);
    const targetWords = Math.min(8000, Math.max(300, Math.round(dto.targetWords || currentWords || 1500)));
    const minTargetWords = Math.max(250, Math.round(targetWords * 0.95));
    const maxTargetWords = Math.round(targetWords * 1.05);
    const direction = dto.adjustmentPercent > 0 ? '膨胀' : dto.adjustmentPercent < 0 ? '压缩' : '微调';
    const storyData = this.buildStoryBoundaryReference(dto.storyData, mode);
    const actionFirstRequirement = dto.actionFirstScript
      ? `\n动作主导模式仍然生效：重写后必须以动作、镜头、人物行为、走位、表情反应和场面变化为主，台词为辅；连续台词不要超过2行。\n`
      : '';
    const dialogueFirstRequirement = dto.dialogueFirstScript && !dto.actionFirstScript
      ? `\n台词主导模式仍然生效：重写后必须在保留原剧情的基础上进一步提高台词密度，用对白推进冲突、情感拉扯、信息揭露、试探、威胁、护短、吃醋、误会和反击；动作说明只保留必要表演支点和场面结果。\n`
      : '';
    const romanceLineRules = this.getRomanceLineHardRulesPrompt();

    const microdramaFormatRules = `6. 仍然必须是标准微短剧拍摄剧本格式：场号、人物、△动作/镜头说明、角色对白都要保留。
7. 不要提前写下一集内容，不要改变后续承接边界。`;
    const filmFormatRules = `6. 仍然必须是标准中文电影剧本格式：节拍标题、场号、人物、△动作/镜头说明、角色对白都要保留。
7. 不要提前写下一节拍内容，不要改变后续承接边界。`;
    const novelFormatRules = `6. 仍然必须是网文章节正文格式：章节标题 + 正文段落，不要写成剧本、梗概或分镜。
7. 不要提前写下一章内容，不要改变后续承接边界。`;

    const prompt = `请基于已经写好的${mode === 'microdrama' ? '微短剧单集剧本' : mode === 'film' ? '电影节拍剧本' : '网文单章正文'}，按用户指定的字数目标重新写一遍。

【背景参考】
${dto.context || '无'}
${storyData}
感情线硬规则：
${romanceLineRules}

【当前已写好的第${dto.chapterNumber}${mode === 'microdrama' ? '集剧本' : mode === 'film' ? '节拍剧本' : '章正文'}】
${dto.content}

重写任务：
1. 当前约 ${currentWords} 字，用户要求${direction} ${Math.abs(dto.adjustmentPercent)}%，重写后的目标字数约 ${targetWords} 字，允许 ${minTargetWords}-${maxTargetWords} 字之间浮动。
2. 必须输出完整的第${dto.chapterNumber}${mode === 'microdrama' ? '集剧本' : mode === 'film' ? '节拍剧本' : '章正文'}，而不是修改建议、摘要、差异说明或补丁。
3. 保留原有核心剧情、人物动机、冲突走向、反转、打脸点、爱情线状态、结尾钩子和${mode === 'microdrama' || mode === 'film' ? '剧本格式' : '章节阅读体验'}。
4. 如果是膨胀：不要灌水，不要增加无关支线；主要通过补足${mode === 'microdrama' || mode === 'film' ? '可拍摄动作、镜头调度、人物反应、冲突推进、场景细节和潜台词' : '关键动作、人物反应、冲突推进、情绪递进、爽点释放、场景细节和必要对话'}来扩写。
5. 如果是压缩：不要删掉关键剧情和钩子；压掉重复${mode === 'microdrama' || mode === 'film' ? '台词' : '心理描写'}、解释性${mode === 'microdrama' || mode === 'film' ? '对白' : '铺陈'}、冗余动作和可合并的场景，让节奏更紧。
${mode === 'microdrama' ? microdramaFormatRules : mode === 'film' ? filmFormatRules : novelFormatRules}
8. ${this.getPlanningLeakRule()}
${actionFirstRequirement}${dialogueFirstRequirement}
请直接输出重写后的第${dto.chapterNumber}${mode === 'microdrama' ? '集剧本' : mode === 'film' ? '节拍剧本' : '章'}正文。`;

    try {
      const result = await this.llmService.chatWithWriterModel([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ], writerModelSelection.provider, writerModelSelection.model);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('重写章节内容失败:', error);
      throw new Error('AI重写章节内容失败，请稍后重试');
    }
  }

  // 从AI生成的内容中提取章节（不进行重新分割）
  private extractChaptersFromContent(storyContent: string, startChapter: number, endChapter: number): string[] {
    const chapters: string[] = [];
    const expectedCount = Math.max(1, endChapter - startChapter + 1);

    // 按章节标题分割
    const chapterRegex = /^\s*第\s*(\d+)\s*章\s*(?:[：:、.\-— ]*)?(?:\[([^\]\n]+)\]|《([^》\n]+)》|([^\n]{0,24}))\s*$/gm;
    const parts: { chapterNum: number; title: string; content: string; start: number }[] = [];
    let match;

    while ((match = chapterRegex.exec(storyContent)) !== null) {
      const chapterNum = parseInt(match[1]);
      const titleText = (match[2] || match[3] || match[4] || '').trim();
      const title = titleText ? `第${chapterNum}章 ${titleText}` : `第${chapterNum}章`;
      const start = match.index;

      // 添加上一章节的内容（如果有）
      if (parts.length > 0) {
        const prevPart = parts[parts.length - 1];
        prevPart.content = storyContent.slice(prevPart.start, start).trim();
      }

      // 添加新章节
      parts.push({
        chapterNum,
        title,
        content: '',
        start: start
      });
    }

    // 处理最后一个章节的内容
    if (parts.length > 0) {
      parts[parts.length - 1].content = storyContent.slice(parts[parts.length - 1].start).trim();
    }

    // 将AI生成的章节内容按标题切开，并清理重复标题行，避免“章节标题嵌套章节标题”
    if (parts.length >= expectedCount) {
      for (let i = 0; i < expectedCount; i++) {
        const part = parts[i];
        const chapterNum = startChapter + i;

        const normalizedTitle = this.normalizeChapterTitle(part.title, chapterNum, i);
        const body = this.stripLeadingChapterTitleLine(part.content);
        const chapterContent = `${normalizedTitle}\n\n${body}`.trim();

        chapters.push(chapterContent.trim());
      }
    } else {
      console.warn(`章节标题不足，按正文长度兜底拆分: 找到${parts.length}个标题，期望${expectedCount}个章节`);
      return this.splitContentIntoChapterFallback(storyContent, startChapter, endChapter);
    }

    return chapters;
  }

  private normalizeChapterTitle(rawTitle: string, chapterNum: number, index: number): string {
    const titlePart = (rawTitle || '')
      .replace(/^第\s*\d+\s*章\s*/g, '')
      .replace(/^\[|\]$/g, '')
      .trim();
    const fallback = index === 0 ? '危机再起' : '暗潮翻涌';
    return `第${chapterNum}章 ${titlePart || fallback}`;
  }

  private splitContentIntoChapterFallback(storyContent: string, startChapter: number, endChapter: number): string[] {
    const expectedCount = Math.max(1, endChapter - startChapter + 1);
    const body = this.stripLeadingChapterTitleLine(storyContent)
      .replace(/^注意[:：].*$/gm, '')
      .trim();
    const chunks = this.splitTextIntoBalancedChunks(body || storyContent.trim(), expectedCount);

    return chunks.map((chunk, index) => {
      const chapterNum = startChapter + index;
      return `${this.normalizeChapterTitle('', chapterNum, index)}\n\n${chunk.trim()}`.trim();
    });
  }

  private splitTextIntoBalancedChunks(text: string, count: number): string[] {
    const normalized = (text || '').trim();
    if (count <= 1 || normalized.length === 0) return [normalized];

    const chunks: string[] = [];
    let remaining = normalized;

    for (let index = 0; index < count - 1; index++) {
      const remainingSlots = count - index;
      const ideal = Math.floor(remaining.length / remainingSlots);
      const min = Math.max(1, Math.floor(ideal * 0.65));
      const max = Math.min(remaining.length - 1, Math.floor(ideal * 1.35));
      let splitIndex = ideal;

      const windowText = remaining.slice(min, max);
      const boundaryMatches = [...windowText.matchAll(/[。！？!?；;\n]/g)];
      if (boundaryMatches.length > 0) {
        const best = boundaryMatches
          .map(item => min + (item.index || 0) + 1)
          .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
        splitIndex = best;
      }

      chunks.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex).trim();
    }

    chunks.push(remaining.trim());
    return chunks;
  }

  /**
   * 从章节文本中抽取“可用于续写的结尾锚点”
   * - 只取正文末尾，避免标题/空行
   * - 优先取最后1-2段，控制长度，便于模型紧接续写
   */
  private extractEndingForContinuity(chapterContent: string): string {
    const body = this.stripLeadingChapterTitleLine(chapterContent).trim();
    if (!body) return '';

    // 先按空行切段，取末尾两段；若段落过短则回退到末尾N字
    const paragraphs = body
      .split(/\n\s*\n+/)
      .map(p => p.trim())
      .filter(Boolean);

    let ending = '';
    if (paragraphs.length >= 2) {
      ending = paragraphs.slice(-2).join('\n\n');
    } else if (paragraphs.length === 1) {
      ending = paragraphs[0];
    }

    // 控制长度：尽量在 400-900 字符之间（中文为主）
    const maxLen = 900;
    const minLen = 400;
    if (ending.length > maxLen) {
      ending = ending.slice(ending.length - maxLen);
    } else if (ending.length < minLen) {
      const tail = body.slice(Math.max(0, body.length - maxLen));
      ending = tail.length > ending.length ? tail : ending;
    }

    return ending.trim();
  }

  /**
   * 去掉文本开头的章节标题行（如果存在）
   * 支持：
   * - 第12章 [标题]
   * - 第12章 标题（兼容）
   */
  private stripLeadingChapterTitleLine(text: string): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';
    const lines = trimmed.split('\n');
    if (lines.length === 0) return trimmed;
    const firstLine = lines[0].trim();
    const isTitle = /^第\d+[章节集]\b/.test(firstLine);
    if (!isTitle) return trimmed;
    return lines.slice(1).join('\n').trim();
  }

  /**
   * 用于上下文记忆的紧凑摘要：既给开头，也给结尾，减少“只看开头导致断层”的概率
   */
  private buildCompactChapterDigest(chapterContent: string, chapterNum: number): string {
    const lines = (chapterContent || '').split('\n').map(l => l.trim());
    const titleLine = lines.find(l => /^第\d+[章节集]\b/.test(l)) || `第${chapterNum}章`;
    const body = this.stripLeadingChapterTitleLine(chapterContent);
    const head = body.slice(0, 260).trim();
    const tail = body.slice(Math.max(0, body.length - 260)).trim();
    return `${titleLine}\n- 开头片段：${head}${head.length ? '…' : ''}\n- 结尾片段：${tail}`;
  }

  /**
   * 最近生成内容摘要（用于跨小故事连续性）：包含每章标题 + 开头/结尾片段
   */
  private buildRecentSummaryForContext(chapters: string[], storyStartChapter: number, storyEndChapter: number): string {
    const titles = chapters
      .map(ch => (ch.split('\n').find(l => /^第\d+[章节集]\b/.test(l.trim())) || '').trim())
      .filter(Boolean)
      .join(', ');

    const snippets = chapters.map((ch, idx) => {
      const num = storyStartChapter + idx;
      const body = this.stripLeadingChapterTitleLine(ch);
      const head = body.slice(0, 180).trim();
      const tail = body.slice(Math.max(0, body.length - 180)).trim();
      return `第${num}章 摘要：开头「${head}…」 结尾「${tail}」`;
    }).join('\n');

    return `第${storyStartChapter}-${storyEndChapter}章：${titles}\n${snippets}`;
  }

  /**
   * 从一段文本中抽取“最后一句”，用于强制续写锚点
   * 若没有明显句末标点，则回退为末尾一小段
   */
  private extractLastSentence(text: string): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    // 优先找最后一个中文句末标点
    const punctuations = ['。', '！', '？', '…', '!', '?'];
    let lastPuncIndex = -1;
    for (const p of punctuations) {
      const idx = trimmed.lastIndexOf(p);
      if (idx > lastPuncIndex) lastPuncIndex = idx;
    }

    if (lastPuncIndex >= 0 && lastPuncIndex < trimmed.length - 1) {
      // 取最后一个句末标点之后的内容也可能是引号/换行，这里取“最后一句”的尾段更稳
      // 目标：返回末尾约40-120字，给模型一个明确续写钩子
      const sentenceCandidate = trimmed.slice(Math.max(0, lastPuncIndex - 120), trimmed.length).trim();
      return sentenceCandidate;
    }

    // 回退：取末尾一小段
    return trimmed.slice(Math.max(0, trimmed.length - 120)).trim();
  }

  private getPlanningLeakRule(): string {
    return '正文只呈现角色正在经历的故事，禁止提及、照抄或解释任何创作后台信息，包括但不限于“小故事卡”“技法卡”“一级结构”“卡点定位”“目的”“承载主线”“情绪骨架”“商业要素”“阶段状态小结”“当前剧情参考”“所属中故事”等词语或其内容。';
  }

  private removeInlinePlanningMetadata(text: string): string {
    return String(text || '')
      .replace(/[（(][^（）()\n]*(?:桥段类型|爱情线一级结构|好感度|两人关系阶段|关系阶段|爱情线阶段|爱情线ID|承载中故事序号)[^（）()\n]*[）)]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private cleanPublicOutlineMetadata(text?: string): string {
    const blockedFieldLine = /^\s*(?:桥段类型|爱情线一级结构|好感度|两人关系阶段|关系阶段|爱情线阶段|爱情线ID|承载中故事序号)\s*[:：]/;
    return this.removeInlinePlanningMetadata(String(text || ''))
      .split('\n')
      .filter(line => !blockedFieldLine.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private stripPlanningMetadata(text?: string): string {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const blockedPatterns = [
      /小故事卡/,
      /技法卡/,
      /一级结构/,
      /卡点定位/,
      /类型来源/,
      /承载主线/,
      /情绪骨架/,
      /商业要素/,
      /阶段状态小结/,
      /^目的\s*[:：]/,
      /^节点\s*[:：]/,
      /^好感度\s*[:：]/,
      /^两人关系阶段\s*[:：]/,
      /^爱情线阶段\s*[:：]/,
    ];

    return raw
      .split('\n')
      .filter(line => !blockedPatterns.some(pattern => pattern.test(line.trim())))
      .join('\n')
      .trim();
  }

  private buildStoryBoundaryReference(storyData: any, mode: 'novel' | 'microdrama' | 'film'): string {
    if (!storyData) return '';

    const unitName = mode === 'microdrama' ? '本集' : mode === 'film' ? '本节拍' : '本章';
    const boundaryRule = mode === 'microdrama'
      ? '本集剧情范围是唯一可写内容；中故事参考只用于理解背景，不得提前写下一集。'
      : mode === 'film'
        ? '本节拍场景包是唯一可写内容；节拍参考只用于理解电影结构，不得提前写下一节拍。'
      : '本组章节剧情范围是唯一可写内容；所属中故事/阶段剧情只用于理解背景和人物压力，不得提前写后续小故事、后续目标或后续场景。';
    const content = this.stripPlanningMetadata(storyData.content);
    const macroContent = this.stripPlanningMetadata(storyData.macroStoryContent);

    return `【剧情边界参考，仅供内部遵循，不得在正文中说明或复述标签】\n边界硬规则：${boundaryRule}\n${unitName}标题：${storyData.title || '无'}\n${unitName}剧情范围：${content || '无'}\n阶段承接参考：${storyData.macroStoryTitle || '无'}\n${macroContent ? `阶段剧情参考（只作背景，不是本次正文可写范围）：${macroContent}\n` : ''}\n`;
  }

  private async validateAndTrimChapterScope({
    content,
    chapterNumber,
    storyData,
    nextStoryData,
    mode,
    writerModelProvider = 'deepseek',
    writerModel,
  }: {
    content: string;
    chapterNumber: number;
    storyData?: any;
    nextStoryData?: any;
    mode: 'novel' | 'microdrama' | 'film';
    writerModelProvider?: WriterModelProvider;
    writerModel?: string;
  }): Promise<string> {
    const sanitizedContent = this.removePlanningLeakLines(content);
    if (!sanitizedContent?.trim() || !storyData?.content) {
      return sanitizedContent;
    }

    const unitLabel = mode === 'microdrama' ? '集' : '章';
    const currentScope = `标题：${storyData.title || '无'}\n内容：${storyData.content || '无'}\n所属中故事：${storyData.macroStoryTitle || '无'}\n中故事内容：${storyData.macroStoryContent || '无'}`;
    const nextScope = nextStoryData
      ? `标题：${nextStoryData.title || '无'}\n内容：${nextStoryData.content || '无'}`
      : '无下一小故事/分集参考。';

    const prompt = `你是正文范围校验员。请判断“已生成正文”是否写出了当前小故事/分集细纲范围之外的内容，尤其是否提前探入下一个小故事/分集。

【当前${mode === 'microdrama' ? '分集' : mode === 'film' ? '节拍场景' : '小故事'}细纲】
${currentScope}

【下一个${mode === 'microdrama' ? '分集' : mode === 'film' ? '节拍' : '小故事'}参考】
${nextScope}

【已生成的第${chapterNumber}${unitLabel}正文】
${sanitizedContent}

判断规则：
1. 如果正文整体仍属于当前细纲范围，即使结尾有合理钩子，也算 scope_ok=true。
2. 如果正文开始写下一小故事/下一分集才应该展开的行动、场景、结果、反转或新目标，算越界。
3. 网文模式下，一个小故事只覆盖当前这一章；只要正文进入下一章/下一小故事才应该展开的场景、目标、行动、结果或反转，就算越界。
4. 如果越界，只需要指出“从原文哪里开始删除”。delete_from_excerpt 必须从【已生成正文】里逐字复制第一句越界内容开头处连续 20-80 个字符，方便程序本地定位裁剪。
5. 不要返回裁剪后的正文，不要复述正文。

只返回 JSON，不要代码块，不要解释：
{"scope_ok":true,"delete_from_excerpt":"","reason":""}
或
{"scope_ok":false,"delete_from_excerpt":"从这里开始的一小段原文","reason":"一句话说明越界原因"}`;

    try {
      const response = await this.llmService.chatWithWriterModel([
        { role: 'system', content: '你只做文本范围校验，必须返回可解析 JSON。' },
        { role: 'user', content: prompt },
      ], writerModelProvider, writerModel);

      const verdict = this.parseScopeVerdict(response || '');
      if (!verdict || verdict.scope_ok || !verdict.delete_from_excerpt?.trim()) {
        return sanitizedContent;
      }

      const cutIndex = this.findDeletionStartIndex(sanitizedContent, verdict.delete_from_excerpt);
      if (cutIndex < 40) {
        console.warn(`第${chapterNumber}${unitLabel}范围校验要求裁剪，但定位失败或位置过早，保留原文`, verdict);
        return sanitizedContent;
      }

      const trimmed = sanitizedContent.slice(0, cutIndex).trim();
      if (mode === 'novel' && this.getWordCount(trimmed) < 1000) {
        console.warn(`第${chapterNumber}${unitLabel}范围校验裁剪后过短，保留原文`, verdict);
        return sanitizedContent;
      }
      console.log(`第${chapterNumber}${unitLabel}范围校验已本地裁剪，删除起点: ${verdict.delete_from_excerpt.slice(0, 60)}，原因: ${verdict.reason || '未说明'}`);
      return trimmed || sanitizedContent;
    } catch (error) {
      console.error(`第${chapterNumber}${unitLabel}范围校验失败，保留原文:`, error);
      return sanitizedContent;
    }
  }

  private removePlanningLeakLines(content: string): string {
    const blockedPatterns = [
      /小故事卡/,
      /技法卡/,
      /一级结构/,
      /卡点定位/,
      /类型来源/,
      /承载主线/,
      /情绪骨架/,
      /商业要素/,
      /阶段状态小结/,
      /当前剧情参考/,
      /所属中故事/,
      /^目的\s*[:：]/,
      /^节点\s*[:：]/,
    ];

    return String(content || '')
      .split('\n')
      .filter(line => !blockedPatterns.some(pattern => pattern.test(line.trim())))
      .join('\n')
      .trim();
  }

  private parseScopeVerdict(raw: string): { scope_ok: boolean; delete_from_excerpt?: string; reason?: string } | null {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;

    const jsonText = trimmed.startsWith('{')
      ? trimmed
      : trimmed.match(/\{[\s\S]*\}/)?.[0] || '';
    if (!jsonText) return null;

    try {
      const parsed = JSON.parse(jsonText);
      return {
        scope_ok: parsed.scope_ok === true,
        delete_from_excerpt: typeof parsed.delete_from_excerpt === 'string' ? parsed.delete_from_excerpt : '',
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    } catch {
      return null;
    }
  }

  private findDeletionStartIndex(content: string, excerpt: string): number {
    const cleanedExcerpt = (excerpt || '')
      .trim()
      .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '');
    if (!cleanedExcerpt) return -1;

    const exactIndex = content.indexOf(cleanedExcerpt);
    if (exactIndex >= 0) return exactIndex;

    const compact = (text: string) => {
      const chars: string[] = [];
      const map: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!/\s/.test(ch)) {
          chars.push(ch);
          map.push(i);
        }
      }
      return { text: chars.join(''), map };
    };

    const compactContent = compact(content);
    const compactExcerpt = compact(cleanedExcerpt).text;
    const compactIndex = compactContent.text.indexOf(compactExcerpt);
    if (compactIndex >= 0) return compactContent.map[compactIndex] ?? -1;

    const sentenceCandidates = cleanedExcerpt
      .split(/[。！？!?；;\n]/)
      .map(part => part.trim())
      .filter(part => part.length >= 12)
      .sort((a, b) => b.length - a.length);

    for (const candidate of sentenceCandidates) {
      const idx = content.indexOf(candidate);
      if (idx >= 0) return idx;
    }

    return -1;
  }

  // 计算字数
  private getWordCount(content: string): number {
    // 移除标题行，然后计算中文字符数
    const lines = content.split('\n');
    const contentLines = lines.filter(line => !line.match(/^第\d+[章节集]\s*\[/)); // 过滤掉标题行
    const text = contentLines.join('\n');

    // 计算中文字符数（不包括英文和数字）
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    return chineseChars.length;
  }

  async exportMicrodramaMarkdown(dto: ExportMicrodramaMarkdownDto) {
    try {
      const entries = Object.entries(dto.chapters || {})
        .map(([episode, content]) => ({ episode: Number(episode), content: String(content || '').trim() }))
        .filter(item => Number.isFinite(item.episode) && item.content)
        .sort((a, b) => a.episode - b.episode);

      if (!entries.length) {
        throw new Error('没有可导出的剧本正文');
      }

      const bookName = String(dto.bookName || '微短剧剧本').trim() || '微短剧剧本';
      const maxEpisode = Math.max(...entries.map(item => item.episode));
      const compact = (value: unknown, limit = 3000) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value || '', null, 2);
        const trimmed = text.trim();
        return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n...[已截断]` : trimmed;
      };
      const safeFilename = (name: string) => (
        name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || '微短剧审核稿'
      );
      const stripHeading = (content: string, episode: number) => {
        const lines = content.trim().split(/\r?\n/);
        const firstLine = (lines[0] || '').trim();
        const headingPattern = new RegExp(`^(#{1,6}\\s*)?(\\*\\*)?第\\s*${episode}\\s*集(\\*\\*)?(\\s|[：:、.．-]|$)`);
        return headingPattern.test(firstLine) ? lines.slice(1).join('\n').trim() : content.trim();
      };

      const microStorySummary = (dto.savedMicroStories || [])
        .map((story: any, index: number) => {
          const order = Number(story?.order || index + 1);
          const title = story?.title ? `《${story.title}》` : '';
          const content = String(story?.content || story?.description || '').trim();
          return `第${order}集${title}\n${content.slice(0, 900)}`;
        })
        .filter(Boolean)
        .join('\n\n');

      const prompt = `你是短剧平台送审材料整理师。请根据项目资料，生成一份微短剧提交审核用 Markdown 文档的前置材料。

必须严格输出以下结构，且只输出这些前置材料，不要输出“剧本正文”，不要包裹代码块：

# 【自制剧本】-${bookName}

## 基本信息

剧名：${bookName}
一句话梗概：用一句话写清主角、核心困境、核心爽点/情感看点。
故事梗概：用300-500字写完整故事主线、主要矛盾、人物选择与结局方向，适合审核人员快速理解。

## 人物小传

【人物名】
姓名：
性别：
年龄：
身高外形标签：
身份职业：
家庭背景：
社会地位：
长相气质：
穿搭风格：
人物成长动线：

## 剧本大纲

Act1（第1集-第X集）：
第1集：……

要求：
1. 人物小传优先覆盖主角、感情线核心人物、主要配角、贯穿主反派/核心压力源；不要虚构过多无关人物。
2. 剧本大纲按现有集数拆成合理 Act，15集可按1-5、6-10、11-15，30集可按1-10、11-20、21-30；其他集数按剧情节奏拆分。
3. 每集大纲一行，语言简洁，能看出该集主要事件、人物推进和结尾钩子。
4. 文风要像正式送审材料，清楚、规整、可读，不要写提示词说明，不要暴露“AI”“模型”“生成”等字样。

【项目基础资料】
剧名：${bookName}
已写正文集数：${entries.map(item => item.episode).join('、')}

【灵感架构】
${compact(dto.outline, 3000)}

【世界观/背景设定】
${compact(dto.worldSetting, 3500)}

【人物设定】
${compact(dto.characters, 5000)}

【中故事/全剧大纲】
${compact(dto.detailedOutline, 4500)}

【单集细纲摘要】
${microStorySummary || '无'}
`;

      const generatedHeader = await this.chatWithSelectedLogicModel([
        { role: 'user', content: prompt }
      ], dto);

      let header = String(generatedHeader || '')
        .replace(/```markdown|```md|```/g, '')
        .trim();

      const bodyHeadingIndex = header.search(/\n\s*##\s*剧本正文\b/);
      if (bodyHeadingIndex >= 0) {
        header = header.slice(0, bodyHeadingIndex).trim();
      }

      if (!/^#\s*【自制剧本】/.test(header)) {
        header = `# 【自制剧本】-${bookName}\n\n${header}`;
      }

      const scriptBlocks = entries
        .map(item => {
          const heading = item.episode === maxEpisode ? `**第${item.episode}集（大结局）**` : `**第${item.episode}集**`;
          const content = stripHeading(item.content, item.episode) || '本集暂无正文。';
          return `${heading}\n\n${content}`;
        })
        .join('\n\n---\n\n');

      return {
        success: true,
        data: `${header}\n\n## 剧本正文\n\n---\n\n${scriptBlocks}\n`,
        filename: `${safeFilename(bookName)}v1.md`
      };
    } catch (error) {
      console.error('导出短剧审核Markdown失败:', error);
      throw new Error('导出短剧审核Markdown失败，请稍后重试');
    }
  }

  // 导出为DOCX格式（暂时使用文本格式，未来可以升级为真正的DOCX）
  async exportAsDocx(chapters: { [key: number]: string }, bookName: string) {
    try {
      // 按章节编号排序
      const sortedChapterKeys = Object.keys(chapters)
        .map(Number)
        .sort((a, b) => a - b);

      let content = `${bookName}\n\n`;

      // 为每个章节生成格式化的内容
      for (const chapterNum of sortedChapterKeys) {
        const chapterContent = chapters[chapterNum];
        if (chapterContent) {
          // 提取章节标题
          const lines = chapterContent.split('\n');
          const titleLine = lines.find(line => line.match(/^第\d+章\s*\[/));

          if (titleLine) {
            // 在DOCX中，章节标题应该更大更粗
            content += `=== ${titleLine} ===\n\n`;

            // 添加章节正文（跳过标题行）
            const contentStartIndex = lines.findIndex(line => line === titleLine) + 1;
            const bodyContent = lines.slice(contentStartIndex).join('\n');
            content += bodyContent + '\n\n\n';
          } else {
            content += chapterContent + '\n\n\n';
          }
        }
      }

      return {
        success: true,
        data: content.trim(),
        filename: `${bookName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.txt`
      };
    } catch (error) {
      console.error('导出DOCX失败:', error);
      throw new Error('导出失败，请稍后重试');
    }
  }
}
