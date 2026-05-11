// React import not needed with jsx: "react-jsx"
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, BookOpen, Sparkles, FileText, Layers, ChevronRight, CheckCircle, Plus, RefreshCw, Eye, EyeOff, PenTool, Save, X } from 'lucide-react';
import { useWorldSettings, SavedMicroStory, sortSavedMicroStoriesForChapters } from '../contexts/WorldSettingsContext';
import { blueprintApi } from '../services/api';
import { getLogicModelRequestFromSources } from '../utils/llmModelSelection';

/**
 * 过滤AI风格的内容，去掉markdown符号等
 */
function cleanMicroStoryContent(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/`([^`]*)`/g, '$1') // 移除行内代码
    .replace(/\*\*([^*]*)\*\*/g, '$1') // 移除粗体
    .replace(/\*([^*]*)\*/g, '$1') // 移除斜体
    .replace(/^\s*#+\s*/gm, '') // 移除标题符号
    .replace(/^\s*[-*+]\s+/gm, '') // 移除列表符号
    .replace(/^\s*\d+\.\s+/gm, '') // 移除有序列表
    .replace(/^\s*>\s+/gm, '') // 移除引用符号
    .replace(/🌟|⭐|✨|🔥|💎|🎯|👥|📖|🎪|🏆|⚔️|🗡️|🏰|🧙|🐉|🦄|🌈|💫|🌙|☀️|🌟|⭐|✨|🔥|💎|🎯|👥|📖|🎪|🏆|⚔️|🗡️|🏰|🧙|🐉|🦄|🌈|💫|🌙|☀️/g, '') // 移除表情符号
    .replace(/\n{3,}/g, '\n\n') // 压缩多余换行
    .trim();
}

type MicroStoryDraft = { title: string; content: string };
type MicroStoryVariantState = {
  loading: boolean;
  note: string;
  variants: MicroStoryDraft[];
  selectedIndex: number | null;
  error?: string;
};
type MicroStoryBatchVariant = {
  title: string;
  stories: MicroStoryDraft[];
};
type MicroStoryBatchVariantState = {
  loading: boolean;
  note: string;
  variants: MicroStoryBatchVariant[];
  selectedIndex: number | null;
  error?: string;
};

interface StoryStructurePageProps {
  onBack: (targetPage?: string) => void;
  onNavigateToWriter?: () => void;
  setAutoFlowStep?: (step: string) => void;
  setAutoFlowProgress?: (progress: number) => void;
}

export function StoryStructurePage({ onBack, onNavigateToWriter, setAutoFlowStep, setAutoFlowProgress }: StoryStructurePageProps) {
  const { currentProject, updateProject } = useWorldSettings();
  const getLogicModelRequest = () => getLogicModelRequestFromSources(currentProject);
  const detailedOutlineMode = currentProject?.detailedOutlineMode === 'microdrama' ? 'microdrama' : 'novel';
  const isMicrodrama = detailedOutlineMode === 'microdrama';
  const microdramaEpisodeCount: 15 | 30 | 60 | 100 =
    currentProject?.microdramaEpisodeCount === 15 || currentProject?.microdramaEpisodeCount === 30 || currentProject?.microdramaEpisodeCount === 60 || currentProject?.microdramaEpisodeCount === 100
      ? currentProject.microdramaEpisodeCount
      : 30;
  const structureLabels = isMicrodrama
    ? {
        unit: '集',
        macro: '卡点中故事',
        micro: '单集剧本细纲',
        microButton: '生成分集细纲',
        emptyHint: '点击左侧的卡点中故事，查看或生成对应集数的单集剧本细纲',
      }
    : {
        unit: '章',
        macro: '中故事',
        micro: '单章小故事细纲',
        microButton: '生成单章细纲',
        emptyHint: '点击左侧的中故事列表，选择要查看的单章小故事细纲',
      };
  const savedUnitLabel = isMicrodrama ? '分集' : '章节细纲';
  // 用索引而不是内容字符串来选择中故事，避免内容重复/空白差异导致 indexOf 失效
  const [selectedMacroStoryIndex, setSelectedMacroStoryIndex] = useState<number | null>(null);
  const [macroStories, setMacroStories] = useState<string[]>([]);
  const [microStoryOutlines, setMicroStoryOutlines] = useState<{[key: string]: string}>({});
  const [generatingStories, setGeneratingStories] = useState<{[key: string]: boolean}>({});
  const [expandedStories, setExpandedStories] = useState<{[key: string]: boolean}>({});
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{current: number, total: number, currentStory: string} | null>(null);
  const [isEditingMacroStory, setIsEditingMacroStory] = useState(false);
  const [isMacroStoryContentOpen, setIsMacroStoryContentOpen] = useState(false);
  const [macroStoryDraft, setMacroStoryDraft] = useState('');
  const [microStoryDraftsByMacro, setMicroStoryDraftsByMacro] = useState<Record<string, MicroStoryDraft[]>>({});
  const [editingMicroStory, setEditingMicroStory] = useState<{ storyKey: string; index: number } | null>(null);
  const [variantStates, setVariantStates] = useState<Record<string, MicroStoryVariantState>>({});
  const [selectedMicroStoryIndexesByMacro, setSelectedMicroStoryIndexesByMacro] = useState<Record<string, number[]>>({});
  const [batchVariantStates, setBatchVariantStates] = useState<Record<string, MicroStoryBatchVariantState>>({});
  const [macroVariantStates, setMacroVariantStates] = useState<Record<string, MicroStoryVariantState>>({});
  const editingMicroStoryTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedMacroStory = selectedMacroStoryIndex !== null ? macroStories[selectedMacroStoryIndex] : null;

  useEffect(() => {
    setIsMacroStoryContentOpen(false);
  }, [selectedMacroStoryIndex]);

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // 先归零再测量，避免内容删除后高度不回缩
    el.style.height = '0px';
    const max = Math.floor(window.innerHeight * 0.6); // 避免无限变高撑爆页面
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${Math.max(next, 260)}px`;
  };

  useEffect(() => {
    if (!editingMicroStory) return;
    const id = `micro-edit-${editingMicroStory.storyKey}-${editingMicroStory.index}`;
    // 让编辑区出现在视野中间，减少“找输入框”的成本
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 聚焦 + 自适应高度
    if (editingMicroStoryTextareaRef.current) {
      editingMicroStoryTextareaRef.current.focus();
      autoGrowTextarea(editingMicroStoryTextareaRef.current);
    }
  }, [editingMicroStory]);

  const hasSavedMicroStoriesFor = (storyKey: string) =>
    (currentProject?.savedMicroStories || []).some(s => s.macroStoryId === storyKey);

  const chineseNumberToInt = (value: string): number => {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) return Number(normalized);
    const digitMap: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    };
    if (normalized === '十') return 10;
    if (normalized.startsWith('十')) return 10 + (digitMap[normalized.slice(1)] || 0);
    if (normalized.includes('十')) {
      const [tens, ones] = normalized.split('十');
      return (digitMap[tens] || 1) * 10 + (digitMap[ones] || 0);
    }
    return digitMap[normalized] || 0;
  };

  const getOrderedMacroStoryBoundaries = (content: string) => {
    const storyRegex = /【中故事([一二三四五六七八九十\d]+)】/g;
    const matches = [...content.matchAll(storyRegex)];
    const boundaries: Array<RegExpMatchArray & { storyNumber: number }> = [];
    let lastStoryNumber = 0;

    matches.forEach(match => {
      const storyNumber = chineseNumberToInt(match[1] || '');
      if (storyNumber > lastStoryNumber) {
        boundaries.push(Object.assign(match, { storyNumber }));
        lastStoryNumber = storyNumber;
      }
    });

    return boundaries;
  };

  // 解析中故事内容：只在“下一个中故事序号首次出现”时截断，避免正文里重复提到【中故事一】时被误切
  const parseMacroStories = (content: string): string[] => {
    const stories: string[] = [];
    const matches = getOrderedMacroStoryBoundaries(content);

    if (matches.length === 0) {
      console.warn('未找到任何中故事标记');
      return [];
    }

    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const startIndex = currentMatch.index! + currentMatch[0].length;
      const endIndex = nextMatch ? nextMatch.index! : content.length;

      const storyContent = content.slice(startIndex, endIndex).trim();
      if (storyContent.length > 0) {
        stories.push(storyContent);
      }
    }

    console.log('正确解析出中故事数量:', stories.length);
    console.log('中故事内容:', stories);
    return stories;
  };

  // 解析小故事内容，正确提取【小故事X】/【第X章】标记之间的内容
  const parseMicroStoriesFromOutline = (content: string): string[] => {
    const stories: string[] = [];
    const microStoryRegex = /【(?:(?:小故事|分集|单集)[一二三四五六七八九十\d]+|第\s*[一二三四五六七八九十\d]+\s*[章节集])】/g;
    const matches = [...content.matchAll(microStoryRegex)];

    if (matches.length === 0) {
      const sceneLikeEpisodeRegex = /(?:^|\n)(?:第\s*[一二三四五六七八九十\d]+\s*[章节集]|[一二三四五六七八九十\d]+-\d+\s+(?:日|夜))/g;
      const sceneMatches = [...content.matchAll(sceneLikeEpisodeRegex)];
      if (sceneMatches.length > 0) {
        for (let i = 0; i < sceneMatches.length; i++) {
          const currentMatch = sceneMatches[i];
          const nextMatch = sceneMatches[i + 1];
          const startIndex = currentMatch.index!;
          const endIndex = nextMatch ? nextMatch.index! : content.length;
          const storyContent = content.slice(startIndex, endIndex).trim();
          if (storyContent.length > 0) stories.push(storyContent);
        }
      }
      return stories;
    }

    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const startIndex = currentMatch.index! + currentMatch[0].length;
      const endIndex = nextMatch ? nextMatch.index! : content.length;

      const storyContent = content.slice(startIndex, endIndex).trim();
      if (storyContent.length > 0) {
        stories.push(storyContent);
      }
    }
    return stories;
  };

  const buildMicroStoryDraftsFromOutline = (outlineContent: string): MicroStoryDraft[] => {
    return parseMicroStoriesFromOutline(outlineContent).map((c, idx) => ({
      title: getMicroStoryDefaultTitle(idx + 1),
      content: cleanMicroStoryContent(c)
    }));
  };

  const parseVariantDrafts = (content: string): MicroStoryDraft[] => {
    const variants: MicroStoryDraft[] = [];
    const variantRegex = /【方案[一二三\d]+】([^\n]*)/g;
    const matches = [...content.matchAll(variantRegex)];

    if (matches.length === 0) {
      return buildMicroStoryDraftsFromOutline(content).slice(0, 3);
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const startIndex = current.index! + current[0].length;
      const endIndex = next ? next.index! : content.length;
      const title = (current[1] || `方案${getChineseNumber(i + 1)}`)
        .replace(/^[:：\s]+/, '')
        .trim();
      const body = content
        .slice(startIndex, endIndex)
        .replace(/^\s*内容[:：]\s*/m, '')
        .trim();
      if (body) {
        variants.push({
          title: title || `方案${getChineseNumber(i + 1)}`,
          content: cleanMicroStoryContent(body)
        });
      }
    }

    return variants.slice(0, 3);
  };

  const parseBatchVariantDrafts = (content: string, selectedIndexes: number[]): MicroStoryBatchVariant[] => {
    const variants: MicroStoryBatchVariant[] = [];
    const variantRegex = /【方案[一二三\d]+】([^\n]*)/g;
    const matches = [...content.matchAll(variantRegex)];
    const unitName = structureLabels.unit;

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const startIndex = current.index! + current[0].length;
      const endIndex = next ? next.index! : content.length;
      const section = content.slice(startIndex, endIndex).trim();
      const schemeTitle = (current[1] || `方案${getChineseNumber(i + 1)}`).replace(/^[:：\s]+/, '').trim();
      const stories: MicroStoryDraft[] = [];

      selectedIndexes.forEach((selectedIndex) => {
        const labelPattern = `(?:第\\s*${selectedIndex + 1}\\s*${unitName}|${selectedIndex + 1}\\s*${unitName}|${getChineseNumber(selectedIndex + 1)}\\s*${unitName}|小故事\\s*${getChineseNumber(selectedIndex + 1)}|分集\\s*${getChineseNumber(selectedIndex + 1)})`;
        const currentRegex = new RegExp(`【\\s*${labelPattern}\\s*】([^\\n]*)`, 'g');
        const currentMatch = currentRegex.exec(section);
        if (!currentMatch?.index && currentMatch?.index !== 0) return;

        const itemStart = currentMatch.index + currentMatch[0].length;
        const laterHeading = section.slice(itemStart).search(/\n\s*【(?:第\s*\d+\s*[章节集]|小故事|分集|单集)/);
        const itemEnd = laterHeading >= 0 ? itemStart + laterHeading : section.length;
        const title = (currentMatch[1] || getMicroStoryDefaultTitle(selectedIndex + 1)).replace(/^[:：\s]+/, '').trim();
        const body = section.slice(itemStart, itemEnd).replace(/^\s*内容[:：]\s*/m, '').trim();
        stories.push({
          title: title || getMicroStoryDefaultTitle(selectedIndex + 1),
          content: cleanMicroStoryContent(body)
        });
      });

      if (stories.length === selectedIndexes.length) {
        variants.push({
          title: schemeTitle || `方案${getChineseNumber(i + 1)}`,
          stories
        });
      }
    }

    return variants.slice(0, 3);
  };

  const getVariantKey = (storyKey: string, microIndex: number) => `${storyKey}_micro_${microIndex}`;

  const updateVariantState = (variantKey: string, update: Partial<MicroStoryVariantState>) => {
    setVariantStates(prev => ({
      ...prev,
      [variantKey]: {
        ...(prev[variantKey] || {
          loading: false,
          note: '',
          variants: [],
          selectedIndex: null
        }),
        ...update
      }
    }));
  };

  const updateBatchVariantState = (storyKey: string, update: Partial<MicroStoryBatchVariantState>) => {
    setBatchVariantStates(prev => ({
      ...prev,
      [storyKey]: {
        ...(prev[storyKey] || {
          loading: false,
          note: '',
          variants: [],
          selectedIndex: null
        }),
        ...update
      }
    }));
  };

  const updateMacroVariantState = (storyKey: string, update: Partial<MicroStoryVariantState>) => {
    setMacroVariantStates(prev => ({
      ...prev,
      [storyKey]: {
        ...(prev[storyKey] || {
          loading: false,
          note: '',
          variants: [],
          selectedIndex: null
        }),
        ...update
      }
    }));
  };

  const toggleMicroStorySelection = (storyKey: string, microIndex: number) => {
    setSelectedMicroStoryIndexesByMacro(prev => {
      const current = prev[storyKey] || [];
      const exists = current.includes(microIndex);
      const next = exists
        ? current.filter(i => i !== microIndex)
        : [...current, microIndex].sort((a, b) => a - b).slice(0, 10);
      return { ...prev, [storyKey]: next };
    });
  };

  // 在 detailedOutline 中，替换某个【中故事X】段落的内容（尽量保留其它文本不变）
  const replaceMacroStoryInDetailedOutline = (detailedOutline: string, macroIndex: number, newContent: string): string => {
    const matches = getOrderedMacroStoryBoundaries(detailedOutline);
    if (matches.length === 0 || macroIndex < 0 || macroIndex >= matches.length) {
      // 回退：用当前 macroStories 重建（可能丢失标记外文本，但保证可用）
      const rebuilt = macroStories
        .map((s, i) => `【中故事${getChineseNumber(i + 1)}】\n${i === macroIndex ? newContent.trim() : s.trim()}\n`)
        .join('\n');
      return rebuilt.trim();
    }

    const currentMatch = matches[macroIndex];
    const nextMatch = matches[macroIndex + 1];
    const startIndex = currentMatch.index! + currentMatch[0].length;
    const endIndex = nextMatch ? nextMatch.index! : detailedOutline.length;

    const before = detailedOutline.slice(0, startIndex);
    const after = detailedOutline.slice(endIndex);

    // 轻量规范化：确保内容左右各有一个换行，避免标记黏连
    const normalizedNew = `\n${newContent.trim()}\n`;
    return `${before}${normalizedNew}${after}`.replace(/\n{3,}/g, '\n\n');
  };

  // 初始化/同步编辑草稿（切换选中中故事时）
  useEffect(() => {
    if (selectedMacroStoryIndex === null) return;
    const storyKey = `story_${selectedMacroStoryIndex}`;

    // 中故事草稿：仅在未处于编辑状态时同步，避免覆盖用户正在输入的内容
    if (!isEditingMacroStory) {
      setMacroStoryDraft(selectedMacroStory || '');
    }

    // 小故事草稿：只在首次进入该中故事时初始化
    setMicroStoryDraftsByMacro(prev => {
      if (prev[storyKey]?.length > 0) return prev;

      const savedForThisMacro = (currentProject?.savedMicroStories || [])
        .filter(s => s.macroStoryId === storyKey)
        .sort((a, b) => a.order - b.order);

      if (savedForThisMacro.length > 0) {
        return {
          ...prev,
          [storyKey]: savedForThisMacro.map((s, idx) => ({
            title: (s.title || getMicroStoryDefaultTitle(idx + 1)).trim(),
            content: s.content ?? ''
          }))
        };
      }

      const outlineContent = microStoryOutlines[storyKey];
      if (outlineContent) {
        return {
          ...prev,
          [storyKey]: buildMicroStoryDraftsFromOutline(outlineContent)
        };
      }

      return { ...prev, [storyKey]: [] };
    });
  }, [
    selectedMacroStoryIndex,
    selectedMacroStory,
    isEditingMacroStory,
    currentProject?.savedMicroStories,
    microStoryOutlines
  ]);

  // 解析中故事内容和加载已保存的微故事卡
  useEffect(() => {
    console.log('StoryStructurePage useEffect triggered, currentProject:', {
      id: currentProject?.id,
      hasDetailedOutline: !!currentProject?.detailedOutline,
      hasMicroStoryOutlines: !!currentProject?.microStoryOutlines,
      microStoryOutlinesKeys: currentProject?.microStoryOutlines ? Object.keys(currentProject.microStoryOutlines) : [],
      savedMicroStoriesCount: currentProject?.savedMicroStories?.length || 0
    });

    if (currentProject?.detailedOutline) {
      const stories = parseMacroStories(currentProject.detailedOutline);
      setMacroStories(stories);
      console.log('解析到中故事:', stories.length, '个');
    }

    // 加载已保存的小故事细纲数据
    if (currentProject?.microStoryOutlines) {
      setMicroStoryOutlines(currentProject.microStoryOutlines);
      console.log('加载已保存的小故事细纲:', Object.keys(currentProject.microStoryOutlines));
    } else {
      console.log('没有microStoryOutlines数据');
    }

    // 加载已保存的小故事数据（用于一键生成的情况）
    if (currentProject?.savedMicroStories) {
      console.log('加载已保存的小故事数据:', currentProject.savedMicroStories.length, '个小故事');
      // 这里可以添加一些状态更新或提示，让用户知道小故事已加载
    } else {
      console.log('没有savedMicroStories数据');
    }
  }, [currentProject?.id, currentProject?.detailedOutline, currentProject?.microStoryOutlines, currentProject?.savedMicroStories]);

  // 检查自动化流程
  useEffect(() => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    if (autoFlowFlag === 'story-structure' && currentProject && macroStories.length >= 3) {
      console.log('检测到自动化流程：开始自动执行一键生成前3个');
      localStorage.removeItem('story-architect-auto-flow');

      // 更新自动化状态
      if (setAutoFlowStep) setAutoFlowStep('正在自动点击"一键生成前3个"...');
      if (setAutoFlowProgress) setAutoFlowProgress(95);

      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        batchGenerateAndSaveMicroStories({ continueToWriter: true });
      }, 1000);
    }
  }, [currentProject, macroStories, setAutoFlowStep, setAutoFlowProgress]);


  // 将数字转换为中文数字
  const getChineseNumber = (num: number): string => {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (num <= 10) return num === 10 ? '十' : digits[num];
    if (num < 20) return `十${digits[num - 10]}`;
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ''}`;
  };

  const getMicroStoryDefaultTitle = (num: number): string => (
    isMicrodrama ? `第${num}集` : `小故事 ${getChineseNumber(num)}`
  );

  const getMicrodramaMacroPlans = (episodeCount: 15 | 30 | 60 | 100) => {
    if (episodeCount === 15) {
      return [
        { startChapter: 1, endChapter: 1 },
        { startChapter: 2, endChapter: 3 },
        { startChapter: 4, endChapter: 6 },
        { startChapter: 7, endChapter: 9 },
        { startChapter: 10, endChapter: 12 },
        { startChapter: 13, endChapter: 15 },
      ];
    }

    if (episodeCount === 100) {
      return Array.from({ length: 10 }, (_, index) => ({
        startChapter: index * 10 + 1,
        endChapter: (index + 1) * 10
      }));
    }

    const plans = [
      { startChapter: 1, endChapter: 2 },
      { startChapter: 3, endChapter: 5 },
    ];

    for (let start = 6; start <= episodeCount; start += 5) {
      plans.push({
        startChapter: start,
        endChapter: Math.min(start + 4, episodeCount)
      });
    }

    return plans;
  };

  const parseMicrodramaRangeFromMacroStory = (storyIndex: number) => {
    const content = macroStories[storyIndex] || '';
    const match = content.match(/对应集数[:：]\s*第\s*(\d+)\s*[-~—至到]\s*(\d+)\s*集/)
      || content.match(/第\s*(\d+)\s*[-~—至到]\s*(\d+)\s*集/);

    if (match) {
      const startChapter = Number(match[1]);
      const endChapter = Number(match[2]);
      if (Number.isFinite(startChapter) && Number.isFinite(endChapter) && endChapter >= startChapter) {
        return { startChapter, endChapter };
      }
    }

    return getMicrodramaMacroPlans(microdramaEpisodeCount)[storyIndex] || {
      startChapter: storyIndex * 10 + 1,
      endChapter: (storyIndex + 1) * 10
    };
  };

  // 计算中故事的章节或集数范围
  const getChapterRange = (storyIndex: number) => {
    if (isMicrodrama) {
      return parseMicrodramaRangeFromMacroStory(storyIndex);
    }

    const chaptersPerMacroStory = isMicrodrama ? 10 : 20;
    const startChapter = storyIndex * chaptersPerMacroStory + 1;
    const endChapter = (storyIndex + 1) * chaptersPerMacroStory;
    return { startChapter, endChapter };
  };

  // 检查中故事是否可以生成（前一个中故事必须已生成）
  const canGenerateStory = (storyIndex: number) => {
    if (storyIndex === 0) return true; // 第一个中故事总是可以生成
    const prevStoryKey = `story_${storyIndex - 1}`;
    // 兼容：如果 prev 的小故事已保存（savedMicroStories），也视为“已完成前序”
    return !!microStoryOutlines[prevStoryKey] || hasSavedMicroStoriesFor(prevStoryKey);
  };

  // 生成小故事细纲
  const generateMicroStories = async (storyIndex: number, macroStory: string) => {
    // 检查是否可以生成
    if (!canGenerateStory(storyIndex)) {
      alert('请先按顺序生成前面的中故事');
      return;
    }

    const storyKey = `story_${storyIndex}`;
    setGeneratingStories(prev => ({ ...prev, [storyKey]: true }));

    try {
      const chineseIndex = getChineseNumber(storyIndex + 1);
      const chapterRange = getChapterRange(storyIndex);

      const response = await blueprintApi.generateMicroStories({
        ...getLogicModelRequest(),
        macroStory,
        storyIndex: chineseIndex,
        chapterRange: `${chapterRange.startChapter}-${chapterRange.endChapter}`,
        mode: detailedOutlineMode,
      });

      console.log(`生成中故事${chineseIndex}的小故事细纲成功 (${structureLabels.unit}: ${chapterRange.startChapter}-${chapterRange.endChapter})`);

	      // 保存到本地状态
	      const newOutlines = { ...microStoryOutlines, [storyKey]: response.data };
	      setMicroStoryOutlines(newOutlines);
	      setMicroStoryDraftsByMacro(prev => ({
	        ...prev,
	        [storyKey]: buildMicroStoryDraftsFromOutline(response.data)
	      }));
	      setExpandedStories(prev => ({ ...prev, [storyKey]: true }));
	      setSelectedMacroStoryIndex(storyIndex);

      // 保存到项目
      if (currentProject) {
        const microStoriesParsed = parseMicroStoriesFromOutline(response.data);
        const savedMicroStories: SavedMicroStory[] = microStoriesParsed.map((content, index) => ({
          id: `${storyKey}_micro_${index}_${Date.now()}_${Math.random()}`,
          title: isMicrodrama
            ? `第${chapterRange.startChapter + index}集`
            : `第${chapterRange.startChapter + index}章`,
          content: cleanMicroStoryContent(content),
          macroStoryId: storyKey,
          macroStoryTitle: `中故事 ${storyIndex + 1}`,
          macroStoryContent: macroStory,
          order: index,
          createdAt: new Date().toISOString()
        }));
        const filteredSaved = (currentProject.savedMicroStories || []).filter(existing =>
          existing.macroStoryId !== storyKey
        );

        const updatedSaved = sortSavedMicroStoriesForChapters([...filteredSaved, ...savedMicroStories]);
        updateProject(currentProject.id, {
          microStoryOutlines: newOutlines,
          savedMicroStories: updatedSaved,
          selectedMicroStories: updatedSaved,
          autoSelectedStories: false,
          autoGenerationMode: false,
          autoGenerationStarted: false,
        });
      }

    } catch (error) {
      console.error(`生成中故事${storyIndex + 1}的小故事细纲失败:`, error);
      alert(`生成中故事${storyIndex + 1}的小故事细纲失败，请稍后重试`);
    } finally {
      setGeneratingStories(prev => ({ ...prev, [storyKey]: false }));
    }
  };

  // 一键批量生成下一个3个中故事的小故事细纲并保存
  const batchGenerateAndSaveMicroStories = async (opts: { continueToWriter?: boolean } = {}) => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    if (macroStories.length < 3) {
      alert('需要至少3个中故事才能使用一键生成功能');
      return;
    }

    try {
      // 根据已保存的小故事所属中故事，计算应该生成哪几个中故事。
      const savedMicroStoriesCount = currentProject.savedMicroStories?.length || 0;
      const savedMacroStoryIds = new Set((currentProject.savedMicroStories || []).map(story => story.macroStoryId));
      const startMacroStoryIndex = macroStories.findIndex((_, index) => !savedMacroStoryIds.has(`story_${index}`));

      // 检查是否有足够的未生成中故事
      const availableMacroStories = macroStories.length - startMacroStoryIndex;
      if (startMacroStoryIndex < 0 || availableMacroStories <= 0) {
        alert(`所有中故事都已生成完毕！已保存 ${savedMicroStoriesCount} 个小故事。`);
        return;
      }

      // 确定要生成的中故事数量（最多3个）
      const targetCount = Math.min(3, availableMacroStories);
      const targetStories = macroStories.slice(startMacroStoryIndex, startMacroStoryIndex + targetCount);

      setBatchGenerating(true);
      setBatchGenerationProgress({ current: 0, total: targetCount, currentStory: '准备开始...' });

      console.log(`检测到已保存 ${savedMicroStoriesCount} 个小故事，下一个未保存中故事序号：${startMacroStoryIndex + 1}`);
      console.log(`将生成中故事 ${startMacroStoryIndex + 1} 到 ${startMacroStoryIndex + targetCount} 的小故事`);

      let generatedOutlines = { ...microStoryOutlines };
      let allSavedMicroStories: SavedMicroStory[] = currentProject.savedMicroStories || [];

      for (let i = 0; i < targetStories.length; i++) {
        const storyIndex = startMacroStoryIndex + i;
        const macroStory = targetStories[i];
        const storyKey = `story_${storyIndex}`;

        setBatchGenerationProgress({
          current: i + 1,
          total: targetCount,
          currentStory: `正在生成中故事 ${storyIndex + 1} 的小故事细纲...`
        });

        // 检查是否已经生成过
        if (!generatedOutlines[storyKey]) {
          // 生成小故事细纲
          const chineseIndex = getChineseNumber(storyIndex + 1);
          const chapterRange = getChapterRange(storyIndex);

          const response = await blueprintApi.generateMicroStories({
        ...getLogicModelRequest(),
            macroStory,
            storyIndex: chineseIndex,
            chapterRange: `${chapterRange.startChapter}-${chapterRange.endChapter}`,
            mode: detailedOutlineMode,
          });

          console.log(`批量生成：中故事${chineseIndex}的小故事细纲成功`);

          // 更新本地状态
          generatedOutlines = { ...generatedOutlines, [storyKey]: response.data };

          // 保存到项目
          updateProject(currentProject.id, {
            microStoryOutlines: generatedOutlines
          });
        }

        setBatchGenerationProgress({
          current: i + 1,
          total: targetCount,
          currentStory: `正在保存中故事 ${storyIndex + 1} 的小故事...`
        });

        // 保存小故事
        const outlineContent = generatedOutlines[storyKey];
        if (outlineContent) {
          // 解析小故事内容
	          const microStoriesParsed = parseMicroStoriesFromOutline(outlineContent);
          const chapterRange = getChapterRange(storyIndex);

          // 创建保存的小故事数据
          const savedMicroStories: SavedMicroStory[] = microStoriesParsed.map((content, index) => ({
            id: `${storyKey}_micro_${index}_${Date.now()}_${Math.random()}`,
            title: isMicrodrama
              ? `第${chapterRange.startChapter + index}集`
              : `第${chapterRange.startChapter + index}章`,
            content: cleanMicroStoryContent(content),
            macroStoryId: storyKey,
            macroStoryTitle: `中故事 ${storyIndex + 1}`,
            macroStoryContent: macroStory,
            order: index,
            createdAt: new Date().toISOString()
          }));

          // 合并到总的小故事列表中，删除该中故事之前保存的所有小故事（完全覆盖）
          const filteredSaved = allSavedMicroStories.filter(existing =>
            existing.macroStoryId !== storyKey
          );

          allSavedMicroStories = [...filteredSaved, ...savedMicroStories];
        }
      }

	      // 更新本地状态
	      setMicroStoryOutlines(generatedOutlines);
	      setMicroStoryDraftsByMacro(prev => {
	        const next = { ...prev };
	        Object.entries(generatedOutlines).forEach(([storyKey, outline]) => {
	          next[storyKey] = buildMicroStoryDraftsFromOutline(outline);
	        });
	        return next;
	      });

      // 保存所有小故事到项目
      const sortedSavedMicroStories = sortSavedMicroStoriesForChapters(allSavedMicroStories);
      updateProject(currentProject.id, {
        savedMicroStories: sortedSavedMicroStories,
        selectedMicroStories: sortedSavedMicroStories,
        autoSelectedStories: !!opts.continueToWriter,
        autoGenerationMode: !!opts.continueToWriter,
        autoGenerationStarted: !!opts.continueToWriter,
      });

      setBatchGenerationProgress({
        current: targetCount,
        total: targetCount,
        currentStory: opts.continueToWriter ? '完成！正在跳转到正文写作...' : '完成！小故事已保存'
      });

      if (opts.continueToWriter) {
        // 只有全自动流程才设置自动正文写作标志；手动细化小故事只保存，不自动跑正文。
        localStorage.setItem('story-architect-auto-flow', 'writer');
        localStorage.setItem('story-architect-auto-flow-project-id', String(currentProject.id));
        localStorage.setItem('story-architect-auto-flow-source', 'full-auto');
        localStorage.setItem('story-architect-auto-flow-created-at', String(Date.now()));
        localStorage.setItem('story-architect-auto-export-json', 'true');

        // 延迟跳转，让用户看到完成状态
        setTimeout(() => {
          console.log('情节结构细化完成，自动跳转到正文写作界面');
          onNavigateToWriter?.();
        }, 2000);
      }

    } catch (error) {
      console.error('批量生成失败:', error);
      alert('批量生成过程中出现错误，请稍后重试');
    } finally {
      setBatchGenerating(false);
      setBatchGenerationProgress(null);
    }
  };


  // 切换展开/收起状态
  const toggleExpanded = (storyIndex: number) => {
    const storyKey = `story_${storyIndex}`;
    setExpandedStories(prev => ({
      ...prev,
      [storyKey]: !prev[storyKey]
    }));
  };

  // 保存小故事到项目
  const saveMicroStories = (storyIndex: number, macroStory: string) => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    const storyKey = `story_${storyIndex}`;
    const drafts = microStoryDraftsByMacro[storyKey];
    const outlineContent = microStoryOutlines[storyKey];

    // 1) 优先保存“人工编辑草稿”（保证你修改后点保存就生效）
    let storyDraftsToSave: MicroStoryDraft[] | null = null;
    if (drafts && drafts.length > 0) {
      storyDraftsToSave = drafts;
	    } else if (outlineContent) {
	      // 2) 兼容旧流程：没有草稿时，从 microStoryOutlines 解析并保存
	      storyDraftsToSave = buildMicroStoryDraftsFromOutline(outlineContent);
    }

    if (!storyDraftsToSave || storyDraftsToSave.length === 0) {
      alert('没有找到小故事内容，请先生成小故事细纲或先编辑后再保存');
      return;
    }

    const existingSaved = currentProject.savedMicroStories || [];
    const existingForMacro = existingSaved
      .filter(s => s.macroStoryId === storyKey)
      .sort((a, b) => a.order - b.order);
    const existingByOrder = new Map(existingForMacro.map(s => [s.order, s] as const));

    const nowIso = new Date().toISOString();
    const chapterRange = getChapterRange(storyIndex);

    // 创建保存的小故事数据（尽量复用旧id/createdAt，避免引用失效）
    const savedMicroStories: SavedMicroStory[] = storyDraftsToSave.map((draft, index) => {
      const prev = existingByOrder.get(index);
      return {
        id: prev?.id || `${storyKey}_micro_${index}_${Date.now()}`,
        title: (draft.title || (isMicrodrama
          ? `第${chapterRange.startChapter + index}集`
          : `第${chapterRange.startChapter + index}章`)).trim(),
        content: draft.content ?? '',
        macroStoryId: storyKey,
        macroStoryTitle: `中故事 ${storyIndex + 1}`,
        macroStoryContent: macroStory,
        order: index,
        createdAt: prev?.createdAt || nowIso
      };
    });

    // 获取现有的保存列表
    // 删除该中故事之前保存的所有小故事（完全覆盖）
    const filteredSaved = existingSaved.filter(existing =>
      existing.macroStoryId !== storyKey
    );

    // 检查是否有旧版本被覆盖
    const oldCount = existingSaved.length - filteredSaved.length;
    const hasOldVersion = oldCount > 0;

    // 更新项目 - 先删除旧的，再添加新的
    const updatedSaved = sortSavedMicroStoriesForChapters([...filteredSaved, ...savedMicroStories]);
    updateProject(currentProject.id, {
      savedMicroStories: updatedSaved,
      selectedMicroStories: updatedSaved,
      autoSelectedStories: false,
      autoGenerationMode: false,
      autoGenerationStarted: false,
    });

    const message = hasOldVersion
      ? `成功保存 ${savedMicroStories.length} 个${savedUnitLabel}（已覆盖之前的 ${oldCount} 个${savedUnitLabel}），项目已更新为最新版本！`
      : `成功保存 ${savedMicroStories.length} 个${savedUnitLabel}，项目已更新为最新版本！`;

    alert(message);
  };

  // 保存“中故事”人工修改（回写 detailedOutline，并同步更新引用到该中故事的小故事）
  const saveEditedMacroStory = (overrideContent?: string, opts?: { silent?: boolean }) => {
    if (!currentProject || selectedMacroStoryIndex === null) return;

    const idx = selectedMacroStoryIndex;
    const storyKey = `story_${idx}`;
    const newContent = overrideContent ?? macroStoryDraft ?? '';

    const updatedMacroStories = [...macroStories];
    updatedMacroStories[idx] = newContent;
    setMacroStories(updatedMacroStories);

    const nextDetailedOutline = currentProject.detailedOutline
      ? replaceMacroStoryInDetailedOutline(currentProject.detailedOutline, idx, newContent)
      : updatedMacroStories.map((s, i) => `【中故事${getChineseNumber(i + 1)}】\n${s.trim()}\n`).join('\n').trim();

    // 同步更新已保存的小故事里对 macroStoryContent 的引用
    const saved = currentProject.savedMicroStories || [];
    const updatedSaved = saved.map(s => (
      s.macroStoryId === storyKey
        ? { ...s, macroStoryContent: newContent, macroStoryTitle: `中故事 ${idx + 1}` }
        : s
    ));

    const selected = currentProject.selectedMicroStories;
    const updatedSelected = selected
      ? selected.map(s => (
          s.macroStoryId === storyKey
            ? { ...s, macroStoryContent: newContent, macroStoryTitle: `中故事 ${idx + 1}` }
            : s
        ))
      : undefined;

    updateProject(currentProject.id, {
      detailedOutline: nextDetailedOutline,
      savedMicroStories: sortSavedMicroStoriesForChapters(updatedSaved),
      ...(updatedSelected ? { selectedMicroStories: updatedSelected } : {})
    });

    setIsEditingMacroStory(false);
    setMacroStoryDraft(newContent);
    if (!opts?.silent) alert('中故事修改已保存！后续引用会自动使用新内容。');
  };

  // 保存单条小故事的人工修改（立即落库到 savedMicroStories，并同步 selectedMicroStories）
  const saveEditedMicroStory = (macroIndex: number, microIndex: number) => {
    if (!currentProject) return;
    const storyKey = `story_${macroIndex}`;
    const drafts = microStoryDraftsByMacro[storyKey] || [];
    if (!drafts[microIndex]) return;

    // 直接复用“保存小故事”逻辑：把该中故事的全部草稿整体保存一次，保证顺序一致
    const macroContentToUse =
      macroIndex === selectedMacroStoryIndex && isEditingMacroStory
        ? (macroStoryDraft ?? '')
        : (macroStories[macroIndex] || '');
    saveMicroStories(macroIndex, macroContentToUse);
    setEditingMicroStory(null);
  };

  const generateMacroStoryVariants = async (macroIndex: number) => {
    if (!currentProject) return;
    const storyKey = `story_${macroIndex}`;
    const state = macroVariantStates[storyKey];
    const selectedVariant = state?.selectedIndex !== null && state?.selectedIndex !== undefined
      ? state.variants[state.selectedIndex]
      : undefined;

    updateMacroVariantState(storyKey, { loading: true, error: undefined });

    try {
      const response = await blueprintApi.generateMicroStoryVariants({
        ...getLogicModelRequest(),
        targetType: 'macro',
        macroStory: macroStories[macroIndex] || '',
        currentTitle: `${structureLabels.macro} ${macroIndex + 1}`,
        currentContent: macroStories[macroIndex] || '',
        previousContent: macroStories[macroIndex - 1],
        nextContent: macroStories[macroIndex + 1],
        selectedVariantTitle: selectedVariant?.title,
        selectedVariantContent: selectedVariant?.content,
        note: state?.note,
        storyIndex: getChineseNumber(macroIndex + 1),
        mode: detailedOutlineMode,
        worldSetting: currentProject.worldSetting || '',
        characters: currentProject.characters || '',
      });

      const variants = parseVariantDrafts(response.data);
      updateMacroVariantState(storyKey, {
        loading: false,
        variants,
        selectedIndex: null,
        error: variants.length === 0 ? '没有解析到中故事候选方案，请重试一次。' : undefined
      });
    } catch (error) {
      console.error('生成中故事候选方案失败:', error);
      updateMacroVariantState(storyKey, {
        loading: false,
        error: '生成中故事候选方案失败，请稍后重试。'
      });
    }
  };

  const applyMacroStoryVariant = (macroIndex: number, variant: MicroStoryDraft) => {
    const content = `${variant.title ? `${variant.title}\n` : ''}${variant.content || ''}`.trim();
    setSelectedMacroStoryIndex(macroIndex);
    saveEditedMacroStory(content, { silent: true });
    setIsEditingMacroStory(false);
  };

  const renderMacroVariantTools = (macroIndex: number) => {
    const storyKey = `story_${macroIndex}`;
    const state = macroVariantStates[storyKey] || {
      loading: false,
      note: '',
      variants: [],
      selectedIndex: null
    };

    return (
      <div className="mt-5 border border-amber-100 bg-amber-50/70 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-amber-900">中故事重构方案池</div>
            <div className="text-xs text-amber-700 mt-1">结合世界观、人设和上下中故事，生成3个新方案。</div>
          </div>
          <button
            onClick={() => generateMacroStoryVariants(macroIndex)}
            disabled={state.loading}
            className="inline-flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium"
          >
            {state.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {state.variants.length > 0 ? '再生成3个中故事方案' : '生成3个中故事方案'}
          </button>
        </div>

        {state.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {state.error}
          </div>
        )}

        <textarea
          value={state.note}
          onChange={(e) => updateMacroVariantState(storyKey, { note: e.target.value })}
          className="w-full min-h-[72px] p-3 border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm text-secondary-800 bg-white"
          placeholder="可先写批注再生成：比如更贴近女主成长、反派压迫感更强、不要改掉下一中故事的开端、爱情线慢一点..."
        />

        {state.variants.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              {state.variants.map((variant, variantIndex) => {
                const isSelected = state.selectedIndex === variantIndex;
                return (
                  <div
                    key={`${storyKey}_macro_${variantIndex}`}
                    className={`border rounded-lg p-3 bg-white ${isSelected ? 'border-amber-300 ring-2 ring-amber-100' : 'border-secondary-200'}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h5 className="font-medium text-secondary-900 text-sm">{variant.title || `方案${getChineseNumber(variantIndex + 1)}`}</h5>
                      <button
                        onClick={() => updateMacroVariantState(storyKey, { selectedIndex: variantIndex })}
                        className={`px-2 py-1 text-xs rounded ${isSelected ? 'bg-amber-600 text-white' : 'bg-secondary-100 hover:bg-secondary-200 text-secondary-700'}`}
                      >
                        {isSelected ? '已选' : '选择'}
                      </button>
                    </div>
                    <div className="text-xs text-secondary-700 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                      {variant.content}
                    </div>
                    <button
                      onClick={() => applyMacroStoryVariant(macroIndex, variant)}
                      className="mt-3 w-full px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                    >
                      采用为当前中故事
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => generateMacroStoryVariants(macroIndex)}
                disabled={state.loading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-md text-sm"
              >
                {state.loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                根据批注再生成3个
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const generateMicroStoryVariants = async (
    macroIndex: number,
    microIndex: number,
    currentDraft: MicroStoryDraft,
    allDrafts: MicroStoryDraft[]
  ) => {
    if (!currentProject) return;

    const storyKey = `story_${macroIndex}`;
    const variantKey = getVariantKey(storyKey, microIndex);
    const state = variantStates[variantKey];
    const selectedVariant = state?.selectedIndex !== null && state?.selectedIndex !== undefined
      ? state.variants[state.selectedIndex]
      : undefined;

    updateVariantState(variantKey, { loading: true, error: undefined });

    try {
      const response = await blueprintApi.generateMicroStoryVariants({
        ...getLogicModelRequest(),
        macroStory: macroStories[macroIndex] || '',
        currentTitle: currentDraft.title || getMicroStoryDefaultTitle(microIndex + 1),
        currentContent: currentDraft.content || '',
        previousContent: allDrafts[microIndex - 1]?.content,
        nextContent: allDrafts[microIndex + 1]?.content,
        selectedVariantTitle: selectedVariant?.title,
        selectedVariantContent: selectedVariant?.content,
        note: state?.note,
        storyIndex: getChineseNumber(macroIndex + 1),
        microIndex: `${microIndex + 1}`,
        mode: detailedOutlineMode,
      });

      const variants = parseVariantDrafts(response.data);
      updateVariantState(variantKey, {
        loading: false,
        variants,
        selectedIndex: null,
        error: variants.length === 0 ? '没有解析到候选方案，请重试一次。' : undefined
      });
    } catch (error) {
      console.error('生成候选方案失败:', error);
      updateVariantState(variantKey, {
        loading: false,
        error: '生成候选方案失败，请稍后重试。'
      });
    }
  };

  const applyMicroStoryVariant = (
    storyKey: string,
    microIndex: number,
    variant: MicroStoryDraft,
    allDrafts: MicroStoryDraft[]
  ) => {
    const nextDrafts = [...allDrafts];
    nextDrafts[microIndex] = {
      title: variant.title || getMicroStoryDefaultTitle(microIndex + 1),
      content: variant.content || ''
    };

    setMicroStoryDraftsByMacro(prev => ({
      ...prev,
      [storyKey]: nextDrafts
    }));
    setEditingMicroStory(null);
    setExpandedStories(prev => ({ ...prev, [storyKey]: true }));
  };

  const renderVariantTools = (
    macroIndex: number,
    storyKey: string,
    microIndex: number,
    draft: MicroStoryDraft,
    allDrafts: MicroStoryDraft[]
  ) => {
    const variantKey = getVariantKey(storyKey, microIndex);
    const state = variantStates[variantKey] || {
      loading: false,
      note: '',
      variants: [],
      selectedIndex: null
    };

    return (
      <div className="mt-4 border-t border-secondary-100 pt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => generateMicroStoryVariants(macroIndex, microIndex, draft, allDrafts)}
            disabled={state.loading || !draft.content}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 disabled:bg-gray-100 disabled:text-gray-400 text-indigo-700 rounded-md font-medium disabled:cursor-not-allowed"
            title="结合前后内容和中故事，生成3个候选方案"
          >
            {state.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {state.variants.length > 0 ? '再生成3个方案' : '生成3个方案'}
          </button>
          {state.variants.length > 0 && (
            <span className="text-xs text-secondary-500">选择一个方案后，可写批注继续迭代。</span>
          )}
        </div>

        {state.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {state.error}
          </div>
        )}

        <textarea
          value={state.note}
          onChange={(e) => updateVariantState(variantKey, { note: e.target.value })}
          className="w-full min-h-[72px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-secondary-800"
          placeholder="可先写批注再生成：比如更狠一点、保留方案二的反转、让女主主动破局、结尾钩子再强一些..."
        />

        {state.variants.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {state.variants.map((variant, variantIndex) => {
                const isSelected = state.selectedIndex === variantIndex;
                return (
                  <div
                    key={`${variantKey}_${variantIndex}`}
                    className={`border rounded-lg p-3 transition-all ${
                      isSelected ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100' : 'border-secondary-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h5 className="font-medium text-secondary-900 text-sm">
                        {variant.title || `方案${getChineseNumber(variantIndex + 1)}`}
                      </h5>
                      <button
                        onClick={() => updateVariantState(variantKey, { selectedIndex: variantIndex })}
                        className={`px-2 py-1 text-xs rounded ${
                          isSelected ? 'bg-indigo-600 text-white' : 'bg-secondary-100 hover:bg-secondary-200 text-secondary-700'
                        }`}
                      >
                        {isSelected ? '已选' : '选择'}
                      </button>
                    </div>
                    <div className="text-xs text-secondary-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                      {variant.content}
                    </div>
                    <button
                      onClick={() => applyMicroStoryVariant(storyKey, microIndex, variant, allDrafts)}
                      className="mt-3 w-full px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                    >
                      采用为当前{structureLabels.unit}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => generateMicroStoryVariants(macroIndex, microIndex, draft, allDrafts)}
                disabled={state.loading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-md text-sm"
              >
                {state.loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                根据批注再生成3条
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const generateBatchMicroStoryVariants = async (macroIndex: number, storyKey: string, allDrafts: MicroStoryDraft[]) => {
    if (!currentProject) return;
    const selectedIndexes = [...(selectedMicroStoryIndexesByMacro[storyKey] || [])].sort((a, b) => a - b);

    if (selectedIndexes.length < 1 || selectedIndexes.length > 10) {
      updateBatchVariantState(storyKey, { error: '请至少选择1个、最多选择10个小故事。' });
      return;
    }

    const isContinuous = selectedIndexes.every((idx, i) => i === 0 || idx === selectedIndexes[i - 1] + 1);
    if (!isContinuous) {
      updateBatchVariantState(storyKey, { error: '请尽量选择连续的小故事，比如2、3、4。' });
      return;
    }

    const state = batchVariantStates[storyKey];
    const selectedVariant = state?.selectedIndex !== null && state?.selectedIndex !== undefined
      ? state.variants[state.selectedIndex]
      : undefined;
    const firstIndex = selectedIndexes[0];
    const lastIndex = selectedIndexes[selectedIndexes.length - 1];

    updateBatchVariantState(storyKey, { loading: true, error: undefined });

    try {
      const response = await blueprintApi.generateMicroStoryVariants({
        ...getLogicModelRequest(),
        macroStory: macroStories[macroIndex] || '',
        currentTitle: selectedIndexes.map(i => allDrafts[i]?.title || getMicroStoryDefaultTitle(i + 1)).join(' / '),
        currentContent: selectedIndexes.map(i => allDrafts[i]?.content || '').join('\n\n'),
        previousContent: allDrafts[firstIndex - 1]?.content,
        nextContent: allDrafts[lastIndex + 1]?.content,
        targetStories: selectedIndexes.map(i => ({
          index: i,
          title: allDrafts[i]?.title || getMicroStoryDefaultTitle(i + 1),
          content: allDrafts[i]?.content || ''
        })),
        selectedVariantStories: selectedVariant?.stories.map((story, offset) => ({
          index: selectedIndexes[offset],
          title: story.title,
          content: story.content
        })),
        note: state?.note,
        storyIndex: getChineseNumber(macroIndex + 1),
        microIndex: selectedIndexes.map(i => `${i + 1}`).join(','),
        mode: detailedOutlineMode,
      });

      const variants = parseBatchVariantDrafts(response.data, selectedIndexes);
      updateBatchVariantState(storyKey, {
        loading: false,
        variants,
        selectedIndex: null,
        error: variants.length === 0 ? '没有解析到连续候选方案，请重试一次。' : undefined
      });
    } catch (error) {
      console.error('生成连续候选方案失败:', error);
      updateBatchVariantState(storyKey, {
        loading: false,
        error: '生成连续候选方案失败，请稍后重试。'
      });
    }
  };

  const applyBatchMicroStoryVariant = (
    storyKey: string,
    allDrafts: MicroStoryDraft[],
    selectedIndexes: number[],
    variant: MicroStoryBatchVariant
  ) => {
    const nextDrafts = [...allDrafts];
    selectedIndexes.forEach((microIndex, offset) => {
      const replacement = variant.stories[offset];
      if (!replacement) return;
      nextDrafts[microIndex] = {
        title: replacement.title || getMicroStoryDefaultTitle(microIndex + 1),
        content: replacement.content || ''
      };
    });

    setMicroStoryDraftsByMacro(prev => ({
      ...prev,
      [storyKey]: nextDrafts
    }));
    setExpandedStories(prev => ({ ...prev, [storyKey]: true }));
  };

  const renderBatchVariantTools = (macroIndex: number, storyKey: string, allDrafts: MicroStoryDraft[]) => {
    const selectedIndexes = [...(selectedMicroStoryIndexesByMacro[storyKey] || [])].sort((a, b) => a - b);
    const state = batchVariantStates[storyKey] || {
      loading: false,
      note: '',
      variants: [],
      selectedIndex: null
    };

    return (
      <div className="mb-4 border border-indigo-100 bg-indigo-50/60 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-indigo-900">
              连续改写方案池
            </div>
            <div className="text-xs text-indigo-700 mt-1">
              已选择 {selectedIndexes.length} 个：{selectedIndexes.length ? selectedIndexes.map(i => getMicroStoryDefaultTitle(i + 1)).join('、') : '请在下方勾选'}
            </div>
          </div>
          <button
            onClick={() => generateBatchMicroStoryVariants(macroIndex, storyKey, allDrafts)}
            disabled={state.loading || selectedIndexes.length < 1 || selectedIndexes.length > 10}
            className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
          >
            {state.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {state.variants.length > 0 ? '再生成3套连续方案' : '生成3套连续方案'}
          </button>
        </div>

        {state.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {state.error}
          </div>
        )}

        <textarea
          value={state.note}
          onChange={(e) => updateBatchVariantState(storyKey, { note: e.target.value })}
          className="w-full min-h-[72px] p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-secondary-800 bg-white"
          placeholder="可先写批注再生成：比如第2集压迫更狠，第3集让反击提前露出，第4集结尾要接回原来的危机..."
        />

        {state.variants.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              {state.variants.map((variant, variantIndex) => {
                const isSelected = state.selectedIndex === variantIndex;
                return (
                  <div
                    key={`${storyKey}_batch_${variantIndex}`}
                    className={`border rounded-lg p-3 bg-white ${isSelected ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-secondary-200'}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h5 className="font-medium text-secondary-900 text-sm">{variant.title}</h5>
                      <button
                        onClick={() => updateBatchVariantState(storyKey, { selectedIndex: variantIndex })}
                        className={`px-2 py-1 text-xs rounded ${isSelected ? 'bg-indigo-600 text-white' : 'bg-secondary-100 hover:bg-secondary-200 text-secondary-700'}`}
                      >
                        {isSelected ? '已选' : '选择'}
                      </button>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {variant.stories.map((story, idx) => (
                        <div key={idx} className="text-xs text-secondary-700 border-t border-secondary-100 pt-2 first:border-t-0 first:pt-0">
                          <div className="font-medium text-secondary-900">{selectedIndexes[idx] + 1}. {story.title}</div>
                          <div className="whitespace-pre-wrap mt-1 leading-relaxed">{story.content}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => applyBatchMicroStoryVariant(storyKey, allDrafts, selectedIndexes, variant)}
                      className="mt-3 w-full px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                    >
                      采用整套方案
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => generateBatchMicroStoryVariants(macroIndex, storyKey, allDrafts)}
                disabled={state.loading || selectedIndexes.length < 1}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-md text-sm"
              >
                {state.loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                根据批注再生成3套
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-secondary-900 mb-2">未找到项目数据</h2>
          <p className="text-secondary-600 mb-4">请先在界面二中创建和保存项目</p>
          <button
            onClick={() => onBack('world-setting')}
            className="btn btn-primary"
          >
            返回界面二
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => onBack('world-setting')}
                className="p-2 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-secondary-600" />
              </button>
              <div className="p-2 bg-primary-100 rounded-lg">
                <Layers className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-secondary-900">情节结构细化</h1>
                <p className="text-sm text-secondary-600">为每个中故事选择合适的微故事卡</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => batchGenerateAndSaveMicroStories()}
                disabled={batchGenerating || macroStories.length < 3}
                className="flex items-center space-x-2 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-purple-700 text-sm font-medium transition-colors"
                title="根据已保存小故事数量，生成接下来的3个中故事的小故事细纲并保存"
              >
                {batchGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>批量生成中...</span>
                  </>
                ) : (
	                  (() => {
	                    const savedMacroStoryIds = new Set((currentProject?.savedMicroStories || []).map(story => story.macroStoryId));
	                    const nextIndex = macroStories.findIndex((_, index) => !savedMacroStoryIds.has(`story_${index}`));
	                    const availableCount = nextIndex < 0 ? 0 : Math.max(0, macroStories.length - nextIndex);
	                    const nextStart = nextIndex + 1;
	                    const nextEnd = nextIndex < 0 ? 0 : Math.min(nextIndex + 3, macroStories.length);

                    if (availableCount === 0) {
                      return (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>全部细化完毕</span>
                        </>
                      );
                    } else {
                      return (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>细化第{nextStart}-{nextEnd}个</span>
                        </>
                      );
                    }
                  })()
                )}
              </button>
              {batchGenerationProgress && (
                <div className="flex items-center space-x-2 text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm">
                    {batchGenerationProgress.currentStory} ({batchGenerationProgress.current}/{batchGenerationProgress.total})
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-2 text-secondary-600">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm">项目: {currentProject.bookName}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 正文写作入口 */}
        {currentProject?.savedMicroStories && currentProject.savedMicroStories.length > 0 && (
          <div className="mb-8">
            <div className="card p-8 bg-gradient-to-br from-primary-50 via-white to-secondary-50 border-2 border-primary-100">
              <div className="text-center">
                <div className="inline-flex items-center space-x-3 mb-6">
                  <div className="p-3 bg-primary-100 rounded-full">
                    <Sparkles className="w-8 h-8 text-primary-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-secondary-900">✨ 正文写作工作室</h2>
                    <p className="text-secondary-600">基于完整故事架构创作精彩章节</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-3xl font-bold text-primary-600 mb-2">
                      {currentProject.savedMicroStories.length}
                    </div>
                    <div className="text-sm text-secondary-600">{isMicrodrama ? '已保存分集' : '已保存章节细纲'}</div>
                    <div className="text-xs text-secondary-400 mt-1">
                      {isMicrodrama
                        ? `可生成 ${currentProject.savedMicroStories.length} 集剧本正文`
                        : `可生成 ${currentProject.savedMicroStories.length} 章节`}
                    </div>
                  </div>

                  <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-3xl font-bold text-green-600 mb-2">
                      {isMicrodrama ? currentProject.savedMicroStories.length * 1900 : currentProject.savedMicroStories.length * 2200}
                    </div>
                    <div className="text-sm text-secondary-600">预计总字数</div>
                    <div className="text-xs text-secondary-400 mt-1">
                      约{Math.round((isMicrodrama ? currentProject.savedMicroStories.length * 1900 : currentProject.savedMicroStories.length * 2200) / 1000)}千字
                    </div>
                  </div>

                  <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-3xl font-bold text-blue-600 mb-2">
                      AI
                    </div>
                    <div className="text-sm text-secondary-600">智能辅助写作</div>
                    <div className="text-xs text-secondary-400 mt-1">
                      完整上下文支持
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    localStorage.removeItem('story-architect-auto-flow');
                    localStorage.removeItem('story-architect-auto-flow-project-id');
                    localStorage.removeItem('story-architect-auto-flow-source');
                    localStorage.removeItem('story-architect-auto-flow-created-at');
                    onNavigateToWriter?.();
                  }}
                  className="inline-flex items-center space-x-4 px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  <PenTool className="w-6 h-6" />
                  <span>进入正文写作工作室</span>
                  <Sparkles className="w-5 h-5" />
                </button>

                <div className="mt-4 text-sm text-secondary-500">
                  💡 AI将基于完整的故事架构为你创作精彩的章节内容
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧中故事列表 */}
          <div className="lg:col-span-4 space-y-4">
            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <BookOpen className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">{structureLabels.macro}列表</h2>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {macroStories.map((story, index) => {
                  const chapterRange = getChapterRange(index);
                  const storyKey = `story_${index}`;
                  const hasOutline = !!microStoryOutlines[storyKey];
                  const hasSaved = hasSavedMicroStoriesFor(storyKey);
                  const hasGenerated = hasOutline || hasSaved;
                  const canGenerate = canGenerateStory(index);
                  const canSelect = hasGenerated || canGenerate; // 已有内容可看，或满足顺序可生成
                  const isGenerating = generatingStories[`story_${index}`];

                  return (
                    <div
                      key={index}
                      onClick={() => canSelect && setSelectedMacroStoryIndex(index)}
                      className={`p-4 rounded-lg border transition-all ${
                        !canSelect
                          ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                          : selectedMacroStoryIndex === index
                          ? 'border-primary-300 bg-primary-50 cursor-pointer'
                          : 'border-secondary-200 hover:border-secondary-300 hover:bg-secondary-50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className={`font-medium mb-1 ${
                              canGenerate ? 'text-secondary-900' : 'text-secondary-500'
                            }`}>
                              {structureLabels.macro} {index + 1}
                            </h3>
                            <span className="text-xs text-secondary-400 bg-secondary-100 px-2 py-1 rounded">
                              第{chapterRange.startChapter}-{chapterRange.endChapter}{structureLabels.unit}
                            </span>
                          </div>
                          <div className={`text-xs mb-1 ${
                            canGenerate ? 'text-secondary-400' : 'text-secondary-400'
                          }`}>
                            {getChineseNumber(index + 1)}中故事
                          </div>
                          <p className={`text-sm line-clamp-3 mb-2 ${
                            canGenerate ? 'text-secondary-600' : 'text-secondary-500'
                          }`}>
                            {story.substring(0, 100)}...
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              {hasGenerated ? (
                                <span className="text-xs text-green-600 flex items-center">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {hasOutline ? '已生成细纲' : isMicrodrama ? '已保存分集' : '已保存章节细纲'}
                                </span>
                              ) : canGenerate ? (
                                <span className="text-xs text-blue-500">
                                  可生成细纲
                                </span>
                              ) : (
                                <span className="text-xs text-secondary-500">
                                  等待前序生成
                                </span>
                              )}
                            </div>
                            {isGenerating && (
                              <div className="flex items-center text-xs text-blue-600">
                                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                生成中
                              </div>
                            )}
                          </div>
                        </div>
                        <ChevronRight className={`w-5 h-5 mt-1 ${
                          canGenerate ? 'text-secondary-400' : 'text-secondary-300'
                        }`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 右侧小故事细纲显示 */}
          <div className="lg:col-span-8">
            {selectedMacroStory ? (
              <div className="space-y-6">
                {/* 选中的中故事内容 */}
                <div className="card p-4">
                  <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      {structureLabels.macro} {selectedMacroStoryIndex! + 1} 内容
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setIsMacroStoryContentOpen(prev => !prev)}
                        className="flex items-center space-x-2 px-3 py-2 bg-white border border-secondary-200 hover:bg-secondary-50 text-secondary-700 rounded-lg"
                        title={isMacroStoryContentOpen ? '收起中故事内容' : '展开中故事内容'}
                      >
                        <ChevronRight className={`w-4 h-4 transition-transform ${isMacroStoryContentOpen ? 'rotate-90' : ''}`} />
                        <span>{isMacroStoryContentOpen ? '收起中故事' : '展开中故事'}</span>
                      </button>
                      {!isEditingMacroStory ? (
                        <button
                          onClick={() => {
                            setIsEditingMacroStory(true);
                            setIsMacroStoryContentOpen(true);
                            setMacroStoryDraft(selectedMacroStory || '');
                          }}
                          className="flex items-center space-x-2 px-3 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-lg"
                          title="手动编辑该中故事（会影响后续引用）"
                        >
                          <PenTool className="w-4 h-4" />
                          <span>编辑中故事</span>
                        </button>
                      ) : (
                        <>
	                          <button
	                            onClick={() => saveEditedMacroStory()}
                            className="flex items-center space-x-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                            title="保存中故事修改"
                          >
                            <Save className="w-4 h-4" />
                            <span>保存</span>
                          </button>
                          <button
                            onClick={() => {
                              setIsEditingMacroStory(false);
                              setMacroStoryDraft(selectedMacroStory || '');
                            }}
                            className="flex items-center space-x-2 px-3 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-lg"
                            title="取消编辑"
                          >
                            <X className="w-4 h-4" />
                            <span>取消</span>
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => generateMicroStories(selectedMacroStoryIndex!, selectedMacroStory)}
                        disabled={!canGenerateStory(selectedMacroStoryIndex!) || generatingStories[`story_${selectedMacroStoryIndex!}`]}
                        className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {generatingStories[`story_${selectedMacroStoryIndex!}`] ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>生成中...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            <span>{structureLabels.microButton}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {!isMacroStoryContentOpen && !isEditingMacroStory && (
                    <div className="mt-3 text-sm text-secondary-600 line-clamp-2">
                      {selectedMacroStory}
                    </div>
                  )}

                  {(isMacroStoryContentOpen || isEditingMacroStory) && (
                    <div className="mt-4 space-y-4">
                      <div className="prose prose-sm max-w-none">
                        {isEditingMacroStory ? (
                          <textarea
                            value={macroStoryDraft}
                            onChange={(e) => setMacroStoryDraft(e.target.value)}
                            className="w-full min-h-[180px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-secondary-800"
                            placeholder="在这里手动修改该中故事内容，保存后会影响小故事生成与写作引用。"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed max-h-80 overflow-y-auto pr-2">
                            {selectedMacroStory}
                          </div>
                        )}
                      </div>
                      {renderMacroVariantTools(selectedMacroStoryIndex!)}
                    </div>
                  )}
                </div>

                {/* 小故事细纲显示 */}
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      {structureLabels.micro} ({isMicrodrama ? '按集数' : '15章'})
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => saveMicroStories(selectedMacroStoryIndex!, selectedMacroStory)}
                        disabled={
                          !(microStoryDraftsByMacro[`story_${selectedMacroStoryIndex!}`]?.length > 0) &&
                          !microStoryOutlines[`story_${selectedMacroStoryIndex!}`]
                        }
                        className="flex items-center space-x-2 px-3 py-1.5 bg-green-100 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed text-green-700 rounded-md text-sm font-medium"
                        title="保存这些小故事到项目（支持手动编辑后的内容）"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{isMicrodrama ? '保存分集' : '保存章节细纲'}</span>
                      </button>
                      <button
                        onClick={() => toggleExpanded(selectedMacroStoryIndex!)}
                        className="flex items-center space-x-2 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm hover:bg-secondary-200"
                      >
                        {expandedStories[`story_${selectedMacroStoryIndex!}`] ? (
                          <>
                            <EyeOff className="w-4 h-4" />
                            <span>收起</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-4 h-4" />
                            <span>展开</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const storyIndex = selectedMacroStoryIndex!;
                    const storyKey = `story_${storyIndex}`;
                    const outlineContent = microStoryOutlines[storyKey];
                    const isExpanded = expandedStories[storyKey];

                    // 1) 优先展示已保存的小故事（人工修改后也在这里生效）
	                    const savedForThisMacro = (currentProject.savedMicroStories || [])
	                      .filter(s => s.macroStoryId === storyKey)
	                      .sort((a, b) => a.order - b.order);

	                    if (savedForThisMacro.length > 0 && (!outlineContent || !(microStoryDraftsByMacro[storyKey]?.length > 0))) {
	                      const drafts = microStoryDraftsByMacro[storyKey] || [];
	                      const allDrafts = savedForThisMacro.map((s, idx) => drafts[idx] || {
	                        title: s.title || getMicroStoryDefaultTitle(idx + 1),
	                        content: s.content || ''
	                      });
	                      return (
	                        <div className="space-y-4">
	                          {renderBatchVariantTools(storyIndex, storyKey, allDrafts)}
	                          {savedForThisMacro.map((s, microIndex) => {
	                            const isEditing = editingMicroStory?.storyKey === storyKey && editingMicroStory?.index === microIndex;
	                            const draft = allDrafts[microIndex];
	                            const isSelectedForBatch = (selectedMicroStoryIndexesByMacro[storyKey] || []).includes(microIndex);

	                            return (
	                              <div
                                key={s.id}
                                id={`micro-edit-${storyKey}-${microIndex}`}
                                className={`border border-secondary-200 rounded-lg p-4 transition-all ${
                                  isExpanded || isEditing ? '' : 'max-h-24 overflow-hidden'
                                }`}
                              >
	                                <div className="flex items-start space-x-3">
	                                  <button
	                                    onClick={() => toggleMicroStorySelection(storyKey, microIndex)}
	                                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border ${
	                                      isSelectedForBatch ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-primary-100 text-primary-700 border-primary-100'
	                                    }`}
	                                    title={isSelectedForBatch ? '取消选择' : '选择加入连续改写'}
	                                  >
	                                    {microIndex + 1}
	                                  </button>
                                  <div className="flex-1">
                                    <div className={`flex items-start justify-between gap-3 mb-2 ${isEditing ? 'flex-col' : ''}`}>
                                      <div className={`${isEditing ? 'w-full' : 'flex-1'}`}>
                                        {!isEditing ? (
                                          <h4 className="font-medium text-secondary-900">
                                            {s.title || getMicroStoryDefaultTitle(microIndex + 1)}
                                          </h4>
                                        ) : (
                                          <input
                                            value={draft.title}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setMicroStoryDraftsByMacro(prev => ({
                                                ...prev,
                                                [storyKey]: (prev[storyKey] || []).map((d, i) => {
                                                  if (i !== microIndex) return d;
                                                  const safe = d || { title: '', content: '' };
                                                  return { ...safe, title: v };
                                                })
                                              }));
                                            }}
                                            className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-900"
                                            placeholder={`${getMicroStoryDefaultTitle(microIndex + 1)} 标题`}
                                          />
                                        )}
                                      </div>

                                      <div className={`flex items-center space-x-2 flex-shrink-0 ${isEditing ? 'self-end' : ''}`}>
                                        {!isEditing ? (
                                          <button
                                            onClick={() => {
                                              setEditingMicroStory({ storyKey, index: microIndex });
                                              // 确保草稿存在
                                              setMicroStoryDraftsByMacro(prev => {
                                                if (prev[storyKey]?.[microIndex]) return prev;
                                                const next = [...(prev[storyKey] || [])];
                                                next[microIndex] = {
                                                  title: (s.title || getMicroStoryDefaultTitle(microIndex + 1)).trim(),
                                                  content: s.content || ''
                                                };
                                                return { ...prev, [storyKey]: next };
                                              });
                                            }}
                                            className="px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                                            title="编辑该小故事"
                                          >
                                            编辑
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => saveEditedMicroStory(storyIndex, microIndex)}
                                              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                                              title="保存该小故事修改"
                                            >
                                              保存
                                            </button>
                                            <button
                                              onClick={() => {
                                                setEditingMicroStory(null);
                                                // 取消时回滚草稿到已保存内容
                                                setMicroStoryDraftsByMacro(prev => ({
                                                  ...prev,
                                                  [storyKey]: (prev[storyKey] || []).map((d, i) => i === microIndex ? {
                                                    title: (s.title || getMicroStoryDefaultTitle(microIndex + 1)).trim(),
                                                    content: s.content || ''
                                                  } : d)
                                                }));
                                              }}
                                              className="px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                                              title="取消编辑"
                                            >
                                              取消
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {!isEditing ? (
                                      <div className={`text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap ${
                                        isExpanded ? '' : 'line-clamp-3'
                                      }`}>
                                        {s.content}
                                      </div>
	                                    ) : (
	                                      <textarea
                                        ref={editingMicroStory?.storyKey === storyKey && editingMicroStory?.index === microIndex ? editingMicroStoryTextareaRef : undefined}
                                        value={draft.content}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          autoGrowTextarea(e.target);
                                          setMicroStoryDraftsByMacro(prev => ({
                                            ...prev,
                                            [storyKey]: (prev[storyKey] || []).map((d, i) => {
                                              if (i !== microIndex) return d;
                                              const safe = d || { title: '', content: '' };
                                              return { ...safe, content: v };
                                            })
                                          }));
                                        }}
                                        className="w-full min-h-[260px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                                        style={{ overflowY: 'auto', resize: 'none' }}
                                        placeholder="在这里修改小故事内容，保存后写作会引用这里的最新内容。"
	                                      />
	                                    )}
	                                    {renderVariantTools(storyIndex, storyKey, microIndex, draft, allDrafts)}
	                                  </div>
	                                </div>
	                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    // 2) 没有保存过的小故事：显示解析出来的细纲内容，并支持初始化草稿用于编辑后保存
                    if (!outlineContent) {
                      return (
                        <div className="text-center py-8 text-secondary-500">
                          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>尚未生成{structureLabels.micro}</p>
                          <p className="text-sm mt-1">点击上方“{structureLabels.microButton}”按钮</p>
                        </div>
                      );
                    }

	                    const drafts = microStoryDraftsByMacro[storyKey]?.length
	                      ? microStoryDraftsByMacro[storyKey]
	                      : buildMicroStoryDraftsFromOutline(outlineContent);

	                    return (
	                      <div className="space-y-4">
	                        {renderBatchVariantTools(storyIndex, storyKey, drafts)}
	                        {drafts.map((draft, microIndex) => {
	                          const isEditing = editingMicroStory?.storyKey === storyKey && editingMicroStory?.index === microIndex;
	                          const isSelectedForBatch = (selectedMicroStoryIndexesByMacro[storyKey] || []).includes(microIndex);
	                          return (
                            <div
                              key={microIndex}
                              id={`micro-edit-${storyKey}-${microIndex}`}
                              className={`border border-secondary-200 rounded-lg p-4 transition-all ${
                                isExpanded || isEditing ? '' : 'max-h-24 overflow-hidden'
                              }`}
                            >
	                              <div className="flex items-start space-x-3">
	                                <button
	                                  onClick={() => toggleMicroStorySelection(storyKey, microIndex)}
	                                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border ${
	                                    isSelectedForBatch ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-primary-100 text-primary-700 border-primary-100'
	                                  }`}
	                                  title={isSelectedForBatch ? '取消选择' : '选择加入连续改写'}
	                                >
	                                  {microIndex + 1}
	                                </button>
                                <div className="flex-1">
                                  <div className={`flex items-start justify-between gap-3 mb-2 ${isEditing ? 'flex-col' : ''}`}>
                                    <div className={`${isEditing ? 'w-full' : 'flex-1'}`}>
                                      {!isEditing ? (
                                        <h4 className="font-medium text-secondary-900">
                                          {draft.title || getMicroStoryDefaultTitle(microIndex + 1)}
                                        </h4>
                                      ) : (
                                        <input
                                          value={draft.title}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            setMicroStoryDraftsByMacro(prev => ({
                                              ...prev,
                                              [storyKey]: (prev[storyKey] || []).map((d, i) => {
                                                if (i !== microIndex) return d;
                                                const safe = d || { title: '', content: '' };
                                                return { ...safe, title: v };
                                              })
                                            }));
                                          }}
                                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-900"
                                          placeholder={`${getMicroStoryDefaultTitle(microIndex + 1)} 标题`}
                                        />
                                      )}
                                    </div>

                                    <div className={`flex items-center space-x-2 flex-shrink-0 ${isEditing ? 'self-end' : ''}`}>
                                      {!isEditing ? (
                                        <button
                                          onClick={() => {
                                            setEditingMicroStory({ storyKey, index: microIndex });
                                            setMicroStoryDraftsByMacro(prev => ({
                                              ...prev,
                                              [storyKey]: prev[storyKey] || drafts
                                            }));
                                          }}
                                          className="px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                                          title="编辑该小故事"
                                        >
                                          编辑
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => saveEditedMicroStory(storyIndex, microIndex)}
                                            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                                            title="保存该小故事修改"
                                          >
                                            保存
                                          </button>
                                          <button
                                            onClick={() => {
                                              setEditingMicroStory(null);
                                              // 取消：回到展示态（草稿保留，方便继续整体保存）
                                            }}
                                            className="px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                                            title="取消编辑"
                                          >
                                            取消
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {!isEditing ? (
                                    <div className={`text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap ${
                                      isExpanded ? '' : 'line-clamp-3'
                                    }`}>
                                      {draft.content}
                                    </div>
	                                  ) : (
	                                    <textarea
                                      ref={editingMicroStory?.storyKey === storyKey && editingMicroStory?.index === microIndex ? editingMicroStoryTextareaRef : undefined}
                                      value={draft.content}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        autoGrowTextarea(e.target);
                                        setMicroStoryDraftsByMacro(prev => ({
                                          ...prev,
                                          [storyKey]: (prev[storyKey] || []).map((d, i) => {
                                            if (i !== microIndex) return d;
                                            const safe = d || { title: '', content: '' };
                                            return { ...safe, content: v };
                                          })
                                        }));
                                      }}
                                      className="w-full min-h-[260px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                                      style={{ overflowY: 'auto', resize: 'none' }}
                                      placeholder="在这里修改小故事内容，保存后写作会引用这里的最新内容。"
	                                    />
	                                  )}
	                                  {renderVariantTools(storyIndex, storyKey, microIndex, draft, drafts)}
	                                </div>
	                              </div>
	                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center">
                <FileText className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-secondary-900 mb-2">
                  选择一个{structureLabels.macro}查看{structureLabels.micro}
                </h3>
                <p className="text-secondary-600">
                  {structureLabels.emptyHint}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
