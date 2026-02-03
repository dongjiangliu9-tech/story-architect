import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { GenerateWorldSettingDto } from './dto/generate-world-setting.dto';
import { GenerateCharactersDto } from './dto/generate-characters.dto';
import { GenerateDetailedOutlineDto } from './dto/generate-detailed-outline.dto';
import { GenerateMicroStoriesDto } from './dto/generate-micro-stories.dto';
import { GenerateChapterDto } from './dto/generate-chapter.dto';
import { ARCHITECT_SYSTEM_PROMPT } from '../../common/prompts/architect.prompt';
import { Observable } from 'rxjs';

@Injectable()
export class BlueprintService {
  // 临时存储生成请求数据，避免URL过长
  private generationRequests = new Map<string, GenerateChapterDto>();
  // 存储取消状态
  private cancelledRequests = new Set<string>();

  constructor(private llmService: LlmService) {}

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

    const prompt = `基于以下故事大纲，为200万字长篇小说生成完整的世界观基础设定体系：

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

请按上述分类组织输出，确保内容的完整性和可用性。`;

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
      throw new Error('AI生成世界观基础设定超时，请稍后重试');
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

    const prompt = `基于以下故事大纲、世界观基础设定和人物设定，为200万字长篇小说自动生成完整的情节细纲：

故事大纲：
${dto.outline}

世界观基础设定：
${dto.worldSetting}

人物设定：
${dto.characters}

**任务要求：**
请从以下45种中故事类型中自动选择25-30个最适合的类型，为整部小说构建完整的情节框架：

**起源与成长类（4种）：**
问道初庭、潜龙初现、星火复燃、破茧之变

**情感与人性类（9种）：**
情愫暗生、旧恨新谋、古道热肠、万民福祉、误中情网、假面舞会、背刺之痛、蜜语争端、和解之桥

**探索与奥秘类（8种）：**
迷雾揭晓、尘封秘闻、诡局落子、绝地寻生、异域探幽、界域穿行、未来残影、禁忌之门

**冲突与考验类（10种）：**
怀璧之劫、风云擂台、巨鳄相争、盛会风云、生死赌局、智取豪夺、如影随形、暗流行动、异化之躯、不公之刃

**转折与蜕变类（14种）：**
三寸惊雷、失控漩涡、刮目之时、缚能之刻、踪迹成谜、两界纽带、契约束缚、外敌叩关、破枷之行、无中生有、命运交易、微澜访世、悠然时光、养成篇章

**生成要求：**
1. 自动选择25-30个最匹配的中故事类型
2. **每个中故事必须设计为可以支撑20章以上的详细内容**，包含丰富的情节细节、多条支线和深度发展
3. 按照小说时间顺序合理安排中故事，确保整体故事节奏紧凑
4. 确保情节连贯性和人物成长弧线，每个中故事都要推动主角的成长
5. 包含开端、发展、高潮、转折、结局的设计，每个阶段都有具体内容
6. 每个中故事标明所属类别和具体作用
7. **避免简单的情节设定**，每个中故事都要包含复杂的冲突、多层次的矛盾和深刻的主题探讨
8. 确保整体故事可以支撑200万字的长篇小说，情节深度足够
9. **卷结构规划：根据中故事数量合理划分卷，每卷至少包含5个中故事，每卷至少100章**
10. **重要格式要求：每个中故事都要用明确的标题标记**，严格按照以下格式：
    【中故事一】具体的标题内容
    【中故事二】具体的标题内容
    【中故事三】具体的标题内容
    以此类推。确保每个中故事都有这样的标记格式。
11. **每个中故事的标题后面必须直接跟具体的情节描述**，中间不要有额外的空行
12. **示例格式**：
    【中故事一】问道初庭
    在这里写详细的情节描述...

    【中故事二】潜龙初现
    在这里写详细的情节描述...

请直接输出完整的情节细纲，不要列出选择的中故事名称列表。每个中故事的描述要详细具体，可以作为20章内容的框架基础。`;

    try {
      const result = await this.llmService.chat([
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

    const chapterInfo = dto.chapterRange
      ? `，对应小说章节范围：第${dto.chapterRange}章`
      : '';

    const prompt = `基于以下中故事内容，为这部中故事生成10个小故事的具体情节细纲${chapterInfo}：

中故事${dto.storyIndex}内容：
${dto.macroStory}

**任务要求：**
请基于这个中故事的具体情节内容，自动抽取并设计10个小故事，每个小故事都要：
1. 包含完整的情节发展：开端→发展→高潮→结局
2. **强制要求：每个小故事必须写作两章，每章大约2200字，也就是每个小故事总计约4400字内容**
3. 与中故事的主线情节紧密关联
4. 展现不同的叙事角度和人物成长
5. 包含具体的场景描述、对话、冲突和转折
6. **重要：章节编号要连续，${dto.chapterRange ? `从第${dto.chapterRange.split('-')[0]}章开始` : '从当前章节开始'}，确保与整体小说章节连续**

**输出格式要求：**
- 每个小故事用【小故事一】【小故事二】...【小故事十】的格式标记
- 每个小故事后面直接跟具体的情节细纲内容
- 内容要详细具体，便于后续写作参考

请直接输出10个小故事的细纲，不要添加任何额外的说明或格式。`;

    try {
      const result = await this.llmService.chat([
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

  async generateChapter(dto: GenerateChapterDto) {
    console.log(`开始循环生成8章内容，使用模型: deepseek-chat`);

    const startChapter = dto.chapterNumber;
    let fullContent = '';
    let contextMemory = dto.context; // 初始上下文
    let previousEnding = dto.previousEnding || '';

    try {
      // 循环生成8章内容
      for (let i = 0; i < 8; i++) {
        const currentChapterNum = startChapter + i;
        console.log(`正在生成第${currentChapterNum}章...`);

        const previousLastSentence = previousEnding ? this.extractLastSentence(previousEnding) : '';
        const chapterPrompt = `${contextMemory}

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
          { role: 'user', content: chapterPrompt }
        ]);

        console.log(`第${currentChapterNum}章生成成功，长度: ${chapterResult?.length || 0}`);

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

      console.log(`8章内容生成完成，总长度: ${fullContent.length}`);

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

    return new Observable((subscriber) => {
      (async () => {
        try {
          console.log(`开始流式生成8章内容（4个小故事），使用模型: deepseek-chat, 请求ID: ${requestId}`);

          const startChapter = dto.chapterNumber;
          let contextMemory = dto.context;
          let previousEnding = dto.previousEnding || '';

          // 如果是生成后续批次，只提供前两章的内容作为参考，避免上下文过长
          if (startChapter >= 9 && dto.generatedChapters) {
            contextMemory += `\n\n【前两章内容参考】\n`;
            // 只添加前两章的内容作为参考，避免上下文过长导致AI忽略小故事卡
            const referenceChapters = [1, 2];
            for (const chapterNum of referenceChapters) {
              if (dto.generatedChapters[chapterNum]) {
                const chapterContent = dto.generatedChapters[chapterNum];
                // 只保留章节标题和前500字符作为摘要，避免内容过长
                const lines = chapterContent.split('\n');
                const titleLine = lines.find(line => line.match(/^第\d+章\s*\[/));
                const summary = chapterContent.substring(0, 500) + (chapterContent.length > 500 ? '...' : '');
                contextMemory += `第${chapterNum}章${titleLine ? ` ${titleLine.split(' ').slice(1).join(' ')}` : ''}：\n${summary}\n\n`;
              }
            }
            contextMemory += `请基于以上前两章的内容参考，继续创作后续章节，确保故事的连贯性和人物成长的连续性。但必须严格遵循当前小故事卡的内容，不得偏离。\n`;
          }

          // 发送开始信号
          subscriber.next({ data: JSON.stringify({ type: 'start', message: '开始生成章节内容' }) });

          // 每2章生成一个小故事
          for (let storyIndex = 0; storyIndex < 4; storyIndex++) {
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

            const storyStartChapter = startChapter + (storyIndex * 2);
            const storyEndChapter = storyStartChapter + 1;

            // 计算当前小故事对应的savedMicroStories索引
            // 根据实际章节号计算全局小故事索引：第1-2章对应索引0，第3-4章对应索引1，以此类推
            const currentStoryIndex = Math.floor((storyStartChapter - 1) / 2);
            const storyData = dto.savedMicroStories?.[currentStoryIndex];

            // 发送小故事开始信号
            subscriber.next({
              data: JSON.stringify({
                type: 'story_start',
                storyIndex: storyIndex + 1,
                chapters: [storyStartChapter, storyEndChapter],
                message: `开始生成第${storyIndex + 1}个小故事（第${storyStartChapter}-${storyEndChapter}章）`
              })
            });

            console.log(`正在生成第${storyIndex + 1}个小故事（第${storyStartChapter}-${storyEndChapter}章）...`);

            // 构建包含当前小故事的上下文
            let storyContext = contextMemory;

            // 添加最近生成的小故事内容作为参考，避免上下文过长
            if (storyIndex > 0) {
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
            const storyPrompt = `${storyContext}

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
                [{ role: 'user', content: storyPrompt }],
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

                // 直接使用AI生成的完整内容，不进行额外分割
                // 解析AI生成的内容，按章节标题分割
                const chapters = this.extractChaptersFromContent(storyContent, storyStartChapter, storyEndChapter);

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

                  console.log(`第${chapterNum}章生成完成，字数: ${this.getWordCount(chapter)}`);
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

                console.log(`第${storyIndex + 1}个小故事生成成功，包含${chapters.length}个章节`);
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
    const isTitle = /^第\d+章\b/.test(firstLine);
    if (!isTitle) return trimmed;
    return lines.slice(1).join('\n').trim();
  }

  /**
   * 用于上下文记忆的紧凑摘要：既给开头，也给结尾，减少“只看开头导致断层”的概率
   */
  private buildCompactChapterDigest(chapterContent: string, chapterNum: number): string {
    const lines = (chapterContent || '').split('\n').map(l => l.trim());
    const titleLine = lines.find(l => /^第\d+章\b/.test(l)) || `第${chapterNum}章`;
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
      .map(ch => (ch.split('\n').find(l => /^第\d+章\b/.test(l.trim())) || '').trim())
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
    const contentLines = lines.filter(line => !line.match(/^第\d+章\s*\[/)); // 过滤掉标题行
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