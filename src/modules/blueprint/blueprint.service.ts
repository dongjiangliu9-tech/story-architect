import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { GenerateWorldSettingDto } from './dto/generate-world-setting.dto';
import { GenerateCharactersDto } from './dto/generate-characters.dto';
import { GenerateDetailedOutlineDto } from './dto/generate-detailed-outline.dto';
import { GenerateMicroStoriesDto } from './dto/generate-micro-stories.dto';
import { GenerateMicroStoryVariantsDto } from './dto/generate-micro-story-variants.dto';
import { GenerateChapterDto } from './dto/generate-chapter.dto';
import { Observable } from 'rxjs';

@Injectable()
export class BlueprintService {
  // 临时存储生成请求数据，避免URL过长
  private generationRequests = new Map<string, GenerateChapterDto>();
  // 存储取消状态
  private cancelledRequests = new Set<string>();

  constructor(private llmService: LlmService) {}

  private normalizeDetailedOutlineMode(mode?: string): 'novel' | 'microdrama' {
    return mode === 'microdrama' ? 'microdrama' : 'novel';
  }

  private getStoryWritingSystemPrompt(): string {
    return `你是长篇网文与微短剧的剧情统筹写手。你的首要职责是严格执行输入中的限制条件、当前卡片任务和连续性要求，而不是自由发挥。

执行优先级（从高到低）：
1. 当前任务中写明的“必须 / 严禁 / 不得 / 只能”
2. 当前中故事卡 / 小故事卡 / 当前单章或单集任务
3. 已提供的已写内容与连续性约束
4. 人物设定、世界观设定、整体大纲
5. 文采发挥

硬规则：
- 信息不足时，宁可保守，也不要擅自新增设定、偷换动机、跳过铺垫或提前写到下一段剧情。
- 爱情线、升级线、关系线都必须慢推，不得越级。
- 所有关键事件都要有明确因果链：触发原因、人物动机、行动过程、结果与余波。
- 正文必须有成稿感，不能写成提纲扩写、桥段清单或流水账。
- 场景、动作、对话、情绪、因果必须彼此咬合，不要为了赶速度省略必要承接句、反应句和镜头落点。`;
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

  private buildMicrodramaDetailedOutlinePrompts(dto: GenerateDetailedOutlineDto): {
    prompt: string;
    compactPrompt: string;
    safetyPrompt: string;
  } {
    const typePool = this.getMicrodramaTypePoolPrompt();
    const prompt = `基于以下故事大纲、世界观基础设定和人物设定，为该作品生成一版可继续拆成 100 集微短剧的完整剧情大纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

你的任务不是生成“多少章的网文细纲”，而是生成一版可继续拆成 100 集微短剧的完整大纲。

固定结构（必须遵守）：
1. 全剧固定为 100 集，并且必须严格拆成 10 个中故事卡点。
2. 每个中故事固定承载 10 集，对应集数依次为：
   - 【中故事一】第1-10集
   - 【中故事二】第11-20集
   - 一直到【中故事十】第91-100集
3. 后续系统会继续把每个中故事细化成 10 集单集细纲，所以你现在写的每个中故事必须天然能再拆成 10 集连续剧情。
4. 仍然尽量复用网文写法中的“故事线结构 / 爱情线节奏 / 事业线节点 / 技法卡 / 一级结构”，但输出目标改为微短剧 100 集商业大纲。
5. 生成一版可继续拆成 100 集微短剧的完整大纲时，有两个额外硬约束必须严格执行：
   - 第一，100 集完结时，主角不一定要成为这个世界里的最强者，只需要完成阶段性的成功，并形成一个收束合理、足够爽的阶段性结局。
   - 第二，第一个中故事必须足够精彩，且必须明确包含三个故事卡：第1-3集完成第一个中故事卡，第4-6集完成第二个中故事卡，第7-10集完成第三个中故事卡，剧情推进必须非常快，不能慢热。

一、故事线整体结构（必须先确定）：
本剧主结构仍采用以下两种结构之一：
- 方案A：两条事业线 + 一条爱情线
- 方案B：两条爱情线 + 一条事业线

你必须在大纲开头用 1-2 句话明确说明三条线分别是什么，并标明每条线主要由哪些中故事承载。

二、爱情线与事业线约束（尽量复用网文规则）：
1. 爱情线继续遵循：好感度 → 两人关系阶段 → 爱情线阶段 的慢热逻辑。
2. 爱情线阶段仍使用：萍水相逢阶段、爱情喜剧阶段、爱隔山海阶段、大结局阶段。
3. 若某中故事涉及爱情线，必须显式标注：爱情线ID、承载中故事序号、好感度、两人关系阶段、爱情线阶段。
4. 单个中故事最多推进一级，严禁跳级；第1、2个承载中故事严禁直接确认关系或进入大结局阶段。
5. 事业线中故事继续从以下一级结构中选取：阻碍结构、危机结构、装逼结构、探明结构、取得结构、义举结构。
6. 事业线节点继续参考目标行动、状态升级、地图更新、利益团体、资源宝物、角色登退场、关系变化、矛盾升级、戏剧性、预期打破、关键里程碑等。

三、微短剧节奏铁律（必须强执行）：
1. 首个中故事的开局必须是“生死存亡”或“极度屈辱”的高压危机，且在最危急时立刻激活金手指/核心反转/身份反转。
2. 全剧必须保持高情绪密度，不能平铺直叙，不能用“他很愤怒/她很绝望”这种总结词带过。
3. 每一集都默认遵循“压抑 → 爆发”的闭环；每个中故事内部要体现 10 集连续的压抑递进与多次爆发。
4. 每一集都要有钩子，每个中故事的第10集结尾必须是更大的黑场悬念或认知反转。
5. 每个独立桥段都要同时满足：解决一个当前矛盾、埋下一个新危机/新伏笔、完成一次主角心态或实力弧光。
6. 情绪占比整体向“爽感”倾斜，兼顾虐感、甜感、悬念，但禁止连续长时间纯甜或纯虐。
7. 第一个中故事内部必须严格按三张故事卡推进：1-3集一张卡，4-6集一张卡，7-10集一张卡，每张卡都要有独立爆点、反转和钩子。

四、生成时必须执行的三轮内审，但不要把审查过程单独输出出来：
1. 先按【情绪密度与极值控制卡】规划每个中故事的情绪骨架：明确压抑期、爆发期、极端情绪类型、核心反击动作。
2. 再按【桥段密度与钩子调度器】校准：确保每个中故事内部都具备高频钩子、冲突升级、黑场悬念结尾。
3. 最后按【要素提纯与商业闭环校验】自查并重写：强化身份反差、关系背刺、欲望绑定，剔除 AI 平滑感与解释性废话。
4. 你必须完成这三轮内审后，再只输出最终版，不要输出“收到”“体检报告”“思路解释”“审查步骤”。

五、中故事类型池（微短剧模式强约束，10 个中故事必须从这里选主题）：
${typePool}

强制规则：
1. 这次不是从类型池里选 25-30 个，而是必须从以上类型池中精准选择 10 个最适配当前故事设定的类型，分别作为 10 个中故事卡点的主题母题。
2. 每个中故事的主标题必须直接使用类型池中的一个名称，例如“【中故事一】问道初庭”。
3. 不得自创池外类型名，不得把类型池当成可有可无的参考项。
4. 10 个中故事应尽量避免重复类型；优先 10 个全不重复。
5. 你需要先根据故事设定判断最匹配的 10 个类型，再围绕这些类型去设计每个中故事的卡点、冲突、情绪和剧情推进。

六、每个中故事的输出格式（必须统一）：
【中故事一】标题
对应集数：第1-10集
中故事类型来源：明确写出该标题属于上面哪一类
卡点定位：说明这是这一组10集的核心卡点与商业卖点
目的：……
技法卡：……
一级结构：……
承载主线：明确属于哪条事业线/爱情线，起什么作用
情绪骨架：压抑期……；爆发期……
钩子设计：至少写清本段的核心钩子类型与第10集黑场悬念
商业要素：身份要素 / 关系要素 / 欲望要素
节点：……
详细剧情：必须写清这10集的开端、发展、高潮、转折、结局，以及第10集切黑时抛出的更大危机

说明：
1. 一共只输出 10 个中故事，不能多、不能少。
2. 这 10 个中故事标题必须来自上面的类型池，不能临时自拟池外标题。
3. 先完成“从类型池挑选 10 个最适配类型”这一步，再进入剧情设计。
4. 每个中故事都必须足够详细，能继续拆成 10 集单集细纲。
5. 节奏必须像微短剧，不要写成传统长篇网文的平缓章回。
6. 标题后直接跟内容，中间不要空行。
7. 不要先列标题清单，不要解释你的思路，不要寒暄。

请直接输出最终版的微短剧 100 集剧情大纲。`;

    const compactPrompt = `请把以下资料生成成 100 集微短剧大纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

硬要求：
- 全剧固定 100 集，必须拆成 10 个中故事，每个中故事固定 10 集。
- 100 集完结时，主角不一定成为世界最强者，但必须取得阶段性成功，并有合理爽点收束。
- 第一个中故事必须特别精彩，且严格拆成三张故事卡：1-3集一张，4-6集一张，7-10集一张，前10集必须快节奏强推进。
- 10 个中故事标题必须从以下类型池中精准选择，不得自创池外标题：
${typePool}
- 每个中故事都必须写清：对应集数、中故事类型来源、卡点定位、目的、技法卡、一级结构、承载主线、情绪骨架、钩子设计、商业要素、节点、详细剧情。
- 必须内部执行“情绪密度 / 钩子调度 / 商业闭环”三轮校验，但只输出最终版。
- 爱情线必须慢热，不得越级推进。

请直接输出 10 个中故事，不要解释过程。`;

    const safetyPrompt = `请在保持节奏强、钩子密、情绪高压的前提下，用可发布的中性表达方式，输出一版 100 集微短剧剧情大纲。

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

固定要求：
- 全剧固定 100 集，严格拆成 10 个中故事，每个中故事 10 集。
- 100 集版本里，主角不必直接成为世界最强者，但必须取得阶段性成功，并形成合理爽点收束。
- 第一个中故事必须足够精彩，并严格拆成三张故事卡：第1-3集、第4-6集、第7-10集各完成一张，前10集必须高速推进。
- 10 个中故事标题必须从以下类型池中精准选择，不得自创池外标题：
${typePool}
- 每个中故事都必须写清对应集数、中故事类型来源、卡点定位、目的、技法卡、一级结构、承载主线、情绪骨架、钩子设计、商业要素、节点、详细剧情。
- 保持微短剧节奏，但避免过度刺激的直白表述，改写为中性可发布表达。

请直接输出最终大纲，不要解释过程。`;

    return { prompt, compactPrompt, safetyPrompt };
  }

  private getChineseNumber(num: number): string {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (num <= 10) return num === 10 ? '十' : digits[num];
    if (num < 20) return `十${digits[num - 10]}`;
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ''}`;
  }

  private countMacroStories(content?: string): number {
    return content?.match(/【中故事[一二三四五六七八九十\d]+】/g)?.length || 0;
  }

  // 存储生成请求，返回ID
  storeGenerationRequest(dto: GenerateChapterDto): string {
    const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.generationRequests.set(id, dto);
    console.log(`存储生成请求: ${id}, 章节: ${dto.chapterNumber}, 当前存储数量: ${this.generationRequests.size}`);

    // 5分钟后自动清理，避免内存泄漏
    setTimeout(() => {
      this.generationRequests.delete(id);
      console.log(`清理过期请求: ${id}, 剩余数量: ${this.generationRequests.size}`);
    }, 5 * 60 * 1000);

    return id;
  }

  // 获取存储的生成请求
  getGenerationRequest(id: string): GenerateChapterDto | undefined {
    return this.generationRequests.get(id);
  }

  // 获取当前存储的请求数量（用于调试）
  getStoredRequestCount(): number {
    return this.generationRequests.size;
  }

  // 取消生成
  cancelGeneration(requestId: string) {
    this.cancelledRequests.add(requestId);
    console.log(`生成请求 ${requestId} 已被取消`);
  }

  // 检查是否被取消
  isCancelled(requestId: string): boolean {
    return this.cancelledRequests.has(requestId);
  }

  async generateInspiration(dto: GenerateOutlineDto) {
    console.log('开始生成灵感架构:', dto);

    try {
      // 使用详细的Prompt，生成5个架构
      const prompt = `请基于以下创作需求，生成5个详细的故事架构：

频道：${dto.channel}
风格：${dto.style}
主题：${dto.theme}

每个架构需要包含：
1. 架构标题（简洁有力）
2. 核心概念（详细的一句话描述主角、冲突和目标）
3. 人物关系（主角和反派的详细设定及关系）
4. 世界观设定（独特的游戏/世界规则）
5. 主要冲突（核心矛盾和升级机制）
6. 金手指设定（主角的独特能力）

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

金手指设定：
[详细描述主角的能力]

### 架构2：标题
[同上格式]

以此类推生成5个架构。请确保内容详细、有深度，避免使用markdown格式符号，直接用文字描述。`;

      console.log('发送详细Prompt到AI...');
      const result = await this.llmService.chat([
        { role: 'user', content: prompt }
      ]);

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

  private generateFallbackContent(dto: GenerateOutlineDto): string {
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
    const needsUpgradeSystem = dto.needsUpgradeSystem !== false;
    const prompt = needsUpgradeSystem
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
      const result = await this.llmService.chat([
        { role: 'user', content: prompt }
      ]);

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

    const prompt = `基于以下故事大纲和世界观基础设定，为200万字长篇小说生成完整的人物设定体系：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

请生成20-30个角色的完整设定，包括：

**主要角色（5-8个，详细描述）：**
1. 主角 - 极度详细的背景、性格、能力、成长历程
2. 女主 - 极度详细的背景、性格、能力、与主角的感情线
3. 3-4个核心伙伴 - 详细背景、性格、能力、与主角的关系

**配角和反派（15-22个，适度详细）：**
4. 2-3个主要反派 - 详细背景、性格、能力、行动动机
5. 3-4个次要反派 - 背景、性格、能力、作用
6. 8-12个配角 - 姓名、年龄、背景、性格、在故事中的作用
7. 2-3个龙套角色 - 简单背景和作用

**重要限制条件：**
⚠️ 生成的主角不可以姓叶、不可以姓陈、不可以姓顾
⚠️ 名字里不可有默字

**要求：**
- 每个角色都要有姓名、年龄、背景设定、性格特征
- 主要角色要有详细的能力设定、人际关系、当前状态
- 所有角色都要与故事主线有联系，符合世界观设定
- 确保角色多样性，避免脸谱化
- 角色关系网要合理，相互之间要有联系
- **严格遵守上述限制条件**

请按类别组织输出，确保前200章的主要登场角色都被涵盖。`;

    try {
      const result = await this.llmService.chat([
        { role: 'user', content: prompt }
      ]);

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
    if (mode === 'microdrama') {
      const { prompt, compactPrompt, safetyPrompt } = this.buildMicrodramaDetailedOutlinePrompts(dto);
      try {
        const result = await this.llmService.chat([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: prompt }
        ]);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error('微短剧情节细纲主提示词失败，尝试精简重试:', error);
        try {
          const result = await this.llmService.chat([
            { role: 'system', content: this.getStoryWritingSystemPrompt() },
            { role: 'user', content: compactPrompt }
          ]);

          return {
            success: true,
            data: result,
          };
        } catch (compactError) {
          console.error('微短剧情节细纲精简提示词失败，尝试安全重试:', compactError);
          const result = await this.llmService.chat([
            { role: 'system', content: this.getStoryWritingSystemPrompt() },
            { role: 'user', content: safetyPrompt }
          ]);

          return {
            success: true,
            data: result,
          };
        }
      }
    }

    const existingDetailedOutline = dto.existingDetailedOutline?.trim() || '';
    const existingMacroStoryCount = this.countMacroStories(existingDetailedOutline);
    const inferredBatchIndex = Math.min(4, Math.max(1, dto.outlineBatchIndex || Math.floor(existingMacroStoryCount / 10) + 1));
    const batchIndex = inferredBatchIndex;
    const startMacroStoryNumber = (batchIndex - 1) * 10 + 1;
    const endMacroStoryNumber = batchIndex * 10;
    const isFinalBatch = dto.isFinalBatch === true || batchIndex === 4;
    const previousContextBlock = existingDetailedOutline
      ? `\n已有中故事细纲（必须完整承接，不能重复已发生的核心事件）：\n${existingDetailedOutline}\n`
      : '\n已有中故事细纲：无。本次为第一批中故事，应承担开局建立与第一阶段推进。\n';
    const batchStageInstruction = isFinalBatch
      ? '这是第4批，也是全书终局批次：必须承接前30个中故事，把主线矛盾、爱情线/事业线、人物命运和核心伏笔推向高潮并完成结尾收束。'
      : batchIndex === 1
        ? '这是第1批：必须建立开局吸引力、核心矛盾、主角初始成长路径和主要人物关系，但不要写成全书结尾。'
        : `这是第${batchIndex}批：必须在完整引用世界观、人设的基础上，继续承接前${existingMacroStoryCount || startMacroStoryNumber - 1}个中故事的因果、伏笔、人物状态与关系变化，向下一阶段推进，但不要提前写成全书结尾。`;

    const prompt = `基于以下故事大纲、世界观基础设定、人物设定和已有中故事进度，为200万字长篇小说生成阶段性情节细纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

${previousContextBlock}

**本次生成批次（必须遵守）：**
1. 整本小说预计按约 40 个中故事完成，可分 4 次生成；每次只生成 10 个中故事。
2. 本次是第 ${batchIndex}/4 批，只输出【中故事${this.getChineseNumber(startMacroStoryNumber)}】到【中故事${this.getChineseNumber(endMacroStoryNumber)}】，不能多、不能少。
3. ${batchStageInstruction}
4. 每一批都必须完整引用世界观和人设；第2、3、4批还必须把已有中故事作为前文事实，严格保持人物状态、关系、压力、目标和伏笔的连续性。
5. 这 10 个中故事只是当前阶段，不代表用户必须先生成完 40 个中故事；用户生成任意一个中故事后，也可以进入下一步继续细化小故事。

**一、故事线整体结构（必须遵守）：**
本小说以故事线为主。一般情况下采用以下两种结构之一：
- **方案A：两条事业线 + 一条爱情线**
- **方案B：两条爱情线 + 一条事业线**

在生成的中故事中，要明确每条事业线/爱情线分别由哪些中故事承载；事业线中故事遵循下方「事业线一级结构」与「事业线节点类型」，爱情线相关中故事严格遵循「爱情线写作技法」与「爱情线一级结构」。

**二、爱情线写作技法（爱情线相关中故事必须遵循）：**

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
4. **涉及主角与一位或多位配角之间爱情的中故事**，除上述外，还必须按当前爱情线阶段标明：好感度、两人关系阶段、爱情线阶段，并落实该阶段的必有节点与所用可选节点。
5. 事业线中故事的节点设计可参照「事业线节点类型」的 11 类，合理选用目标与行动、里程碑状态、地图更新、利益团体、神器宝物、角色登场退场、关系发展、矛盾出现与升级、戏剧性、预期打破、里程碑情节等。
6. 每个中故事必须能支撑 20 章以上的详细内容，含丰富情节、支线与深度发展。
7. ${batchIndex === 1
      ? '【中故事一】是决定开局生死成败的核心中故事，必须足够精彩、不能拖沓，并且对应的前20章必须严格包含三张故事卡：第1-4章完成第一张卡，第5-12章完成第二张卡，第13-20章完成第三张卡。三张卡必须连续升级、持续爆点、快速推进。'
      : `本批第一个中故事【中故事${this.getChineseNumber(startMacroStoryNumber)}】必须承接上一批结尾的阶段状态、关系变化、压力和目标，不要重新开局，也不要推翻前文事实。`}
8. 按小说时间顺序排列中故事，保证整体节奏紧凑，情节连贯、人物有成长弧线。
9. 每个中故事包含开端、发展、高潮、转折、结局，并标明所属类别与在事业线/爱情线中的作用。
10. 避免简单套路，中故事需有复杂冲突、多层矛盾与主题探讨。
11. 每个中故事结尾必须追加「阶段状态小结」，写清：主角当前状态、主角和主要人物的关系、主角目前受到的压力、主角下一阶段目标方向。
12. 整体按约 40 个中故事支撑 200 万字长篇小说；本次只生成第 ${batchIndex} 批 10 个中故事。${isFinalBatch ? '本批必须完成全书终局、主线收束和人物关系落点。' : '本批结尾要留下可继续生成下一批的推进空间，不能写成全书大结局。'}
13. **格式要求：** 每个中故事用明确标题标记，必须从【中故事${this.getChineseNumber(startMacroStoryNumber)}】开始，到【中故事${this.getChineseNumber(endMacroStoryNumber)}】结束，格式如下：
    【中故事${this.getChineseNumber(startMacroStoryNumber)}】具体的标题内容
    【中故事${this.getChineseNumber(startMacroStoryNumber + 1)}】具体的标题内容
    以此类推。标题后直接跟情节描述，中间不要空行。
14. **示例格式**：
    【中故事${this.getChineseNumber(startMacroStoryNumber)}】问道初庭
    目的：……。技法卡：舞台聚光灯、打破预期。一级结构：取得结构。节点：……
    在这里写详细的情节描述（若涉爱情线，请标明好感度/关系阶段/爱情线阶段及节点）...
    阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

    【中故事${this.getChineseNumber(startMacroStoryNumber + 1)}】潜龙初现
    目的：……。技法卡：……。一级结构：……。……
    在这里写详细的情节描述...
    阶段状态小结：主角当前状态：……；主要人物关系：……；当前压力：……；目标方向：……。

请直接输出本批次的 10 个中故事细纲，不要先列出中故事名称列表。每个中故事的描述要详细具体，可作为 20 章内容的框架基础；事业线中故事体现事业线一级结构与节点类型，爱情线相关中故事必须体现爱情线阶段、节点逻辑与爱情线一级结构。`;

    try {
      const result = await this.llmService.chat([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ]);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('生成情节细纲失败:', error);
      throw new Error('AI生成情节细纲超时，请稍后重试');
    }
  }

  async generateMicroStories(dto: GenerateMicroStoriesDto) {
    console.log(`开始为中故事${dto.storyIndex}生成小故事细纲`);

    const mode = this.normalizeDetailedOutlineMode(dto.mode);
    const unitLabel = mode === 'microdrama' ? '集' : '章';
    const rangeInfo = dto.chapterRange
      ? `，对应${mode === 'microdrama' ? '微短剧集数范围' : '小说章节范围'}：第${dto.chapterRange}${unitLabel}`
      : '';

    const prompt = mode === 'microdrama'
      ? `基于以下中故事内容，为这部中故事生成10个小故事的具体情节细纲${rangeInfo}：

中故事${dto.storyIndex}内容：
${dto.macroStory}

**任务要求：**
1. 输出仍然必须是10个小故事，顺序连续、集数连续、逻辑闭环清晰；在微短剧模式下，每个小故事对应 1 集
2. 每个小故事都必须包含完整的情节发展：开场冲突→升级→爆发→结尾钩子
3. 与中故事的主线情节紧密关联
4. 展现不同的叙事角度和人物成长
5. 包含具体的场景描述、对话、冲突和转折
6. 重要：集数编号要连续，${dto.chapterRange ? `从第${dto.chapterRange.split('-')[0]}集开始` : '从当前集开始'}，确保与整体微短剧集数连续
7. 微短剧节奏硬约束（必须遵守）：
   - 每一集都要完成一次“压抑 → 爆发”的闭环
   - 每一集都必须有钩子，集尾不能平
   - 每一集都应同时满足：解决一个当前矛盾、埋下一个新伏笔/新危机、完成一次主角心态或实力弧光
   - 第10集必须形成这一卡点的黑场悬念或更大反转
8. 爱情线节奏硬约束（如果本中故事涉及爱情线，必须遵守）：
   - 必须读取中故事内标注的：好感度 / 两人关系阶段 / 爱情线阶段 / 爱情线ID / 承载中故事序号
   - 10个小故事只能在“本中故事已标注的阶段上限”内展开与深化，不得越级推进
   - 若中故事为某爱情线的第1-2个承载中故事，严禁写出“确认关系/公开/互许终身/婚嫁落定”等结局性节点
   - 若中故事文本未明确标注上述字段，则默认按“萍水相逢 + 熟悉阶段 + 零好感度”处理，宁慢勿快，避免闪电攻略
9. 生成前请先按“情绪密度与极值控制 / 桥段密度与钩子调度 / 商业闭环校验”三轮自检并完成二次修正，但不要输出自检过程

**输出格式要求：**
- 每个小故事用【小故事一】【小故事二】...【小故事十】的格式标记
- 每个小故事后面直接跟具体的情节细纲内容
- 内容要详细具体，便于后续写作参考

请直接输出10个小故事的细纲，不要添加任何额外的说明或格式。`
      : `基于以下中故事内容，为这部中故事生成10个小故事的具体情节细纲${rangeInfo}：

中故事${dto.storyIndex}内容：
${dto.macroStory}

**任务要求：**
请基于这个中故事的具体情节内容，自动抽取并设计10个小故事，每个小故事都要：
1. 包含完整的情节发展：开端→发展→高潮→结局
2. 强制要求：每个小故事必须写作两章，每章大约2200字，也就是每个小故事总计约4400字内容
3. 与中故事的主线情节紧密关联
4. 展现不同的叙事角度和人物成长
5. 包含具体的场景描述、对话、冲突和转折
6. 重要：章节编号要连续，${dto.chapterRange ? `从第${dto.chapterRange.split('-')[0]}章开始` : '从当前章节开始'}，确保与整体小说章节连续

**输出格式要求：**
- 每个小故事用【小故事一】【小故事二】...【小故事十】的格式标记
- 每个小故事后面直接跟具体的情节细纲内容
- 内容要详细具体，便于后续写作参考

请直接输出10个小故事的细纲，不要添加任何额外的说明或格式。`;

    try {
      const result = await this.llmService.chat([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ]);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error(`生成中故事${dto.storyIndex}的小故事细纲失败:`, error);
      throw new Error('AI生成小故事细纲超时，请稍后重试');
    }
  }

  async generateMicroStoryVariants(dto: GenerateMicroStoryVariantsDto) {
    const mode = this.normalizeDetailedOutlineMode(dto.mode);
    if (dto.targetType === 'macro') {
      const selectedBase = dto.selectedVariantContent
        ? `\n【用户当前更认可的中故事候选版本】\n标题：${dto.selectedVariantTitle || dto.currentTitle}\n内容：${dto.selectedVariantContent}\n`
        : '';
      const noteText = dto.note?.trim()
        ? `\n【用户批注 / 继续优化方向】\n${dto.note.trim()}\n`
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
重构目标：
1. 一次性输出 3 个候选中故事方案，三条必须明显不同，不能只是换说法。
2. 每个方案都必须比原方案更完整，写清：卡点定位、目的、技法卡/一级结构、承载主线、情绪骨架、钩子设计、商业要素、节点、详细剧情。
3. 必须结合世界观和人物设定，不能脱离已有角色动机、能力边界、势力关系和世界规则。
4. 必须兼顾上下中故事连续性：承接前文已经发生的结果，不提前消耗后文核心爆点。
5. ${mode === 'microdrama'
          ? '按微短剧中故事设计：默认承载10集，内部要有连续压抑、爆发、反转和第10集黑场钩子。'
          : '按小说中故事设计：默认能继续拆成10个小故事、20章左右，内部要有完整目标、阻碍、升级和阶段收束。'}
6. 若提供了用户批注，必须显著响应批注；若提供了用户认可的候选版本，以它为优化基础。

输出格式必须严格如下：
【方案一】标题
内容：……

【方案二】标题
内容：……

【方案三】标题
内容：……

不要输出额外说明。`;

      try {
        const result = await this.llmService.chat([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: prompt }
        ]);

        return {
          success: true,
          data: result,
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
生成目标：
1. 一次性输出 3 套候选方案，每套都必须覆盖用户选中的全部${targetStories.length}个${unitLabel}，不能漏项，不能只改其中一个。
2. 每套方案内部必须连续，前后因果要咬合：第一个${unitLabel}制造的问题，后续${unitLabel}要承接、升级或反转。
3. 三套方案之间必须明显不同，例如冲突核心、人物主动性、反转机制、情绪爆点或结尾钩子不同。
4. 必须兼顾选中段落前后的连续性，不能改坏前文动机，也不能提前消耗后文核心爆点。
5. 必须服从所属中故事的主线卡点，不要跳出当前中故事。
6. ${mode === 'microdrama'
        ? '按微短剧连续单集思维设计：每集都有开场冲突、升级、爆发、结尾钩子，同时整段形成更大的连续推进。'
        : '按小说连续小故事思维设计：每个小故事有独立承载，同时整段形成章节群推进。'}
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
生成目标：
1. 一次性输出 3 个候选方案，三条必须明显不同，不能只是换说法。
2. 每个方案都要比原方案更具体，包含可执行的场景推进、人物动作、冲突升级、反转点和结尾钩子。
3. 必须兼顾前后连续性：不能改坏上一${unitLabel}已经建立的动机，也不能提前消耗下一${unitLabel}的核心爆点。
4. 必须服从所属中故事的主线卡点，不要跳出当前中故事。
5. ${mode === 'microdrama'
      ? '按微短剧单集思维设计：开场强冲突，中段升级，后段爆发，结尾黑场钩子；内容应便于继续扩成单集剧本。'
      : '按小说小故事思维设计：保留两章承载空间，写清章节内冲突递进和收束。'}
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
      const result = await this.llmService.chat([
        { role: 'system', content: this.getStoryWritingSystemPrompt() },
        { role: 'user', content: prompt }
      ]);

      return {
        success: true,
        data: result,
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
  ): string {
    const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
    return `${contextMemory}

请基于以上完整的故事背景信息，生成第${episodeNumber}集的标准微短剧正文。

${previousEnding ? `上一集结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一集最后一句（必须在本集开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}
${storyData ? `【当前分集核心细纲】\n标题：${storyData.title}\n内容：${storyData.content}\n所属中故事：${storyData.macroStoryTitle}\n中故事内容：${storyData.macroStoryContent}\n\n` : ''}

写作目标：
1. 输出标准微短剧拍摄剧本格式，不要写成小说正文、散文旁白或分集梗概。
2. 单集总字数严格控制在 1200-1500 字之间；必须是可拍摄的完整剧本。
3. 本集建议 3-5 场，每场都要有清晰场号、时间、内外景、地点、人物、画面动作和对白。
4. 以对白和可见动作为主，少写心理描写；所有动作说明必须是镜头能拍到、演员能表演的内容。
5. 严格遵循当前分集细纲，不能跑去写下一集的内容。
6. 每一集都要完成一次“压抑 → 爆发”的闭环，但节奏要自然长在场景和冲突里，不要写成机械流程图。
7. 开场第一场必须直接进入冲突、羞辱、生死压力、身份失衡或强压局面，不能平铺垫。
8. 对话必须口语化、有情绪方向和信息增量，禁止连续三句平直陈述，禁止长篇解释设定。
9. 每一场戏都要尽量完成三件事：解决一个当前矛盾、埋下一个新的更大危机或疑点、完成一次角色心态/实力/关系弧光。
10. 结尾必须切在更大的危机、秘密揭露、身份反转、生死倒计时或关系爆雷上，形成黑场钩子。
11. 衔接要求：如果提供了“上一集结尾内容”，本集开头必须从该结尾自然续写，延续同一场景/动作/对话，不要回顾式重述。

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
- 不要把大段剧情写成自然段；每一行都要像拍摄剧本一样可拆解执行。

请直接输出该集剧本正文。`;
  }

  async generateChapter(dto: GenerateChapterDto) {
    const mode = this.normalizeDetailedOutlineMode(dto.mode);
    const unitLabel = mode === 'microdrama' ? '集' : '章';
    const loopCount = Math.max(1, dto.unitCount ?? (mode === 'microdrama' ? 1 : 8));
    console.log(`开始循环生成${loopCount}${unitLabel}内容，使用模型: deepseek-chat, 模式: ${mode}`);

    const startChapter = dto.chapterNumber;
    let fullContent = '';
    let contextMemory = dto.context; // 初始上下文
    let previousEnding = dto.previousEnding || '';

    try {
      for (let i = 0; i < loopCount; i++) {
        const currentChapterNum = startChapter + i;
        console.log(`正在生成第${currentChapterNum}${unitLabel}...`);

        const storyData = dto.savedMicroStories?.[mode === 'microdrama'
          ? currentChapterNum - 1
          : Math.floor((currentChapterNum - 1) / 2)];
        const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
        const chapterPrompt = mode === 'microdrama'
          ? this.buildMicrodramaEpisodePrompt(contextMemory, currentChapterNum, previousEnding, storyData)
          : `${contextMemory}

请基于以上完整的故事背景信息，生成第${currentChapterNum}章的内容。

${previousEnding ? `上一章结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一章最后一句（必须在本章开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}

生成要求：
1. 章节标题要吸引人且符合故事风格，标题长度不超过8个字
2. 严格控制字数：每章内容必须在2200-2500字之间
3. 内容要详细丰满，包含具体的场景描写、对话、心理活动和冲突
4. 保持与整体故事的连贯性和人物成长
5. 融入世界观设定和人物关系
6. 章节结尾要为下一章留好铺垫，并自然融入悬念钩子，制造期待感，拉动读者继续阅读的欲望
7. **重要**：钩子要融入正文叙述中，作为故事发展的自然延伸，不要在文章结尾单独添加说明性句子
8. **衔接要求（关键）**：如果提供了“上一章结尾内容”，本章开头必须从该结尾**自然续写**（同一时空/同一动作/同一对话延续），不要用回顾式总结重述上一章；除非上一章结尾明确切换场景，否则开头至少连续推进300字后再转场。

请直接输出章节内容，格式如下：
第${currentChapterNum}章 [章节标题]

[章节正文内容，至少2200字]

注意：不要添加任何多余的说明或格式，直接从章节标题开始输出内容。`;

        // 使用Deepseek模型进行写作
        const chapterResult = await this.llmService.chatWithWriterModel([
          { role: 'system', content: this.getStoryWritingSystemPrompt() },
          { role: 'user', content: chapterPrompt }
        ]);

        console.log(`第${currentChapterNum}${unitLabel}生成成功，长度: ${chapterResult?.length || 0}`);

        // 添加到总内容中
        if (chapterResult) {
          fullContent += chapterResult + '\n\n';
        }

        // 更新上下文记忆 - 只保留最近的剧情摘要，避免上下文过长
        if (chapterResult) {
          // 提取“正文结尾锚点”作为下一章衔接参考（避免截到标题/空行）
          previousEnding = this.extractEndingForContinuity(chapterResult);

          // 更新上下文记忆，保持总长度在合理范围内
          const recent = this.buildCompactChapterDigest(chapterResult, currentChapterNum);
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

  async generateChapterStream(dto: GenerateChapterDto): Promise<Observable<any>> {
    // 生成请求ID
    const requestId = this.storeGenerationRequest(dto);
    const mode = this.normalizeDetailedOutlineMode(dto.mode);
    const unitLabel = mode === 'microdrama' ? '集' : '章';
    const requestedUnitCount = Math.max(1, dto.unitCount ?? (mode === 'microdrama' ? 1 : 8));
    const loopCount = mode === 'microdrama' ? requestedUnitCount : Math.ceil(requestedUnitCount / 2);
    const unitBatchSize = requestedUnitCount;
    const unitsPerStory = mode === 'microdrama' ? 1 : 2;

    return new Observable((subscriber) => {
      (async () => {
        try {
          console.log(`开始流式生成${unitBatchSize}${unitLabel}内容，使用模型: deepseek-chat, 请求ID: ${requestId}, 模式: ${mode}`);

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
              return;
            }

            const storyStartChapter = startChapter + (storyIndex * unitsPerStory);
            const storyEndChapter = mode === 'microdrama' ? storyStartChapter : storyStartChapter + 1;
            const currentStoryIndex = mode === 'microdrama'
              ? storyStartChapter - 1
              : Math.floor((storyStartChapter - 1) / 2);
            const storyData = dto.savedMicroStories?.[currentStoryIndex];

            // 发送小故事开始信号
            subscriber.next({
              data: JSON.stringify({
                type: 'story_start',
                storyIndex: storyIndex + 1,
                chapters: mode === 'microdrama' ? [storyStartChapter] : [storyStartChapter, storyEndChapter],
                message: mode === 'microdrama'
                  ? `开始生成第${storyStartChapter}集`
                  : `开始生成第${storyIndex + 1}个小故事（第${storyStartChapter}-${storyEndChapter}章）`
              })
            });

            console.log(mode === 'microdrama'
              ? `正在生成第${storyStartChapter}集...`
              : `正在生成第${storyIndex + 1}个小故事（第${storyStartChapter}-${storyEndChapter}章）...`);

            // 构建包含当前小故事的上下文
            let storyContext = contextMemory;

            // 添加最近生成的小故事内容作为参考，避免上下文过长
            if (storyIndex > 0 && mode !== 'microdrama') {
              storyContext += `\n\n【最近生成内容参考】\n`;
              // 只包含最近1-2个小故事的内容作为参考，避免累积过多上下文
              const maxPrevStories = Math.min(storyIndex, 2); // 最多只参考最近2个小故事
              for (let i = 1; i <= maxPrevStories; i++) {
                const prevIndex = storyIndex - i;
                if (prevIndex >= 0) {
                  const prevStoryData = dto.savedMicroStories?.[prevIndex];
                  if (prevStoryData) {
                    const prevStartChapter = startChapter + (prevIndex * 2);
                    const prevEndChapter = prevStartChapter + 1;

                    storyContext += `\n【小故事${prevIndex + 1}（第${prevStartChapter}-${prevEndChapter}章）：${prevStoryData.title}】\n`;
                    storyContext += `内容概述：${prevStoryData.content.substring(0, 300)}...\n`; // 减少内容长度
                  }
                }
              }
              storyContext += `\n请确保新章节与以上最近生成的内容自然衔接，保持故事连贯性。但必须严格遵循当前小故事卡的内容，不得偏离。\n`;
            }

            // 添加当前小故事的详细信息
            if (storyData) {
              storyContext += `\n\n【当前小故事详细内容】\n`;
              storyContext += `小故事标题：${storyData.title}\n`;
              storyContext += `小故事内容：${storyData.content}\n`;
              storyContext += `所属中故事：${storyData.macroStoryTitle}\n`;
              storyContext += `中故事内容：${storyData.macroStoryContent}\n`;
            }

            const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
            const storyPrompt = mode === 'microdrama'
              ? this.buildMicrodramaEpisodePrompt(storyContext, storyStartChapter, previousEnding, storyData)
              : `${storyContext}

请基于以上完整的故事背景信息，特别是当前小故事的详细内容，生成两个连续的独立章节。

${previousEnding ? `上一章结尾内容（作为衔接参考）：\n${previousEnding}\n\n${previousLastSentence ? `上一章最后一句（必须在第${storyStartChapter}章开头紧接续写）：\n${previousLastSentence}\n\n` : ''}` : ''}

**⚠️ 重要限制条件：**
- **必须严格遵循当前小故事卡的内容写作**，不能偏离小故事卡规定的情节发展
- **绝对不能涉及或暗示下一小故事的内容**，确保每个小故事都有独立的发展空间
- **如果当前小故事的内容与之前生成的内容有冲突，以当前小故事卡为准**

生成要求：
1. **严格字数控制**：两个章节的总字数必须严格控制在4000-4500字以内，绝对不能超过4500字
2. **章节分配**：第一章约2000-2200字，第二章约2000-2300字，总计4000-4500字
3. 章节标题要吸引人且符合故事风格，标题长度不超过8个字
4. 内容要详细丰满，包含具体的场景描写、对话、心理活动和冲突
5. 保持与整体故事的连贯性和人物成长，特别要衔接好之前已生成的内容
6. 融入世界观设定和人物关系
7. 每个章节结尾要为下一章留好铺垫，并自然融入悬念钩子，制造期待感，拉动读者继续阅读的欲望
8. **重要**：钩子要融入正文叙述中，作为故事发展的自然延伸，不要在文章结尾单独添加说明性句子
9. **字数检查**：生成时请时刻注意字数控制，确保总字数不超过4500字
10. **衔接要求（关键）**：如果提供了“上一章结尾内容”，第${storyStartChapter}章开头必须从该结尾**紧接着续写**（延续同一场景/动作/对话），不要用回顾式总结重述上一章；除非上一章结尾明确切换场景，否则开头至少连续推进300-500字后再转场或跳时。

请按以下格式输出：
第${storyStartChapter}章 [章节标题]

[第${storyStartChapter}章正文内容，2000-2200字]

第${storyEndChapter}章 [章节标题]

[第${storyEndChapter}章正文内容，2000-2200字]

注意：直接输出章节内容，不要添加多余说明。`;

            try {
              let storyContent = '';
              let isFirstChunk = true;

              // 使用流式输出生成一个小故事
              await this.llmService.chatWithWriterModelStream(
                [
                  { role: 'system', content: this.getStoryWritingSystemPrompt() },
                  { role: 'user', content: storyPrompt }
                ],
                (chunk: string) => {
                  storyContent += chunk;

                  // 发送小故事内容块
                  subscriber.next({
                    data: JSON.stringify({
                      type: 'story_chunk',
                      storyIndex: storyIndex + 1,
                      content: storyContent,
                      isFirst: isFirstChunk
                    })
                  });

                  if (isFirstChunk) {
                    isFirstChunk = false;
                  }
                }
              );

              if (storyContent) {
                // 发送小故事完成信号
                subscriber.next({
                  data: JSON.stringify({
                    type: 'story_complete',
                    storyIndex: storyIndex + 1,
                    content: storyContent
                  })
                });

                const chapters = mode === 'microdrama'
                  ? [storyContent.trim()]
                  : this.extractChaptersFromContent(storyContent, storyStartChapter, storyEndChapter);

                // 发送每个章节
                chapters.forEach((chapter, index) => {
                  const chapterNum = storyStartChapter + index;

                  subscriber.next({
                    data: JSON.stringify({
                      type: 'chapter_complete',
                      chapter: chapterNum,
                      content: chapter
                    })
                  });

                  console.log(`第${chapterNum}${unitLabel}生成完成，字数: ${this.getWordCount(chapter)}`);
                });

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

        } catch (error) {
          console.error('流式生成失败:', error);
          subscriber.error(error);
        }
      })();
    });
  }

  // 从AI生成的内容中提取章节（不进行重新分割）
  private extractChaptersFromContent(storyContent: string, startChapter: number, endChapter: number): string[] {
    const chapters: string[] = [];

    // 按章节标题分割
    const chapterRegex = /第(\d+)章\s*\[([^\]]+)\]/g;
    const parts: { title: string; content: string; start: number }[] = [];
    let match;
    let lastIndex = 0;

    while ((match = chapterRegex.exec(storyContent)) !== null) {
      const chapterNum = parseInt(match[1]);
      const title = match[0];
      const start = match.index;

      // 添加上一章节的内容（如果有）
      if (parts.length > 0) {
        const prevPart = parts[parts.length - 1];
        prevPart.content = storyContent.slice(prevPart.start, start).trim();
      }

      // 添加新章节
      parts.push({
        title,
        content: '',
        start: start
      });

      lastIndex = start;
    }

    // 处理最后一个章节的内容
    if (parts.length > 0) {
      parts[parts.length - 1].content = storyContent.slice(parts[parts.length - 1].start).trim();
    }

    // 将AI生成的章节内容按标题切开，并清理重复标题行，避免“章节标题嵌套章节标题”
    if (parts.length >= 2) {
      for (let i = 0; i < Math.min(parts.length, 2); i++) {
        const part = parts[i];
        const chapterNum = startChapter + i;

        const normalizedTitle = `第${chapterNum}章 ${part.title.split(' ').slice(1).join(' ')}`.trim();
        const body = this.stripLeadingChapterTitleLine(part.content);
        const chapterContent = `${normalizedTitle}\n\n${body}`.trim();

        chapters.push(chapterContent.trim());
      }
    } else {
      // 如果没有找到章节标题，直接将整个内容作为第一个章节
      console.warn('未找到章节标题，将内容作为单个章节处理');
      chapters[0] = `第${startChapter}章 [第一章]

${storyContent}`;

      // 如果需要第二章，创建一个空章节（不添加任何内容提示）
      if (startChapter !== endChapter) {
        chapters[1] = `第${endChapter}章 [第二章]

`;
      }
    }

    return chapters;
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
