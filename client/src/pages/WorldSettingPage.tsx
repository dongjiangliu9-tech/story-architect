// React import not needed with jsx: "react-jsx"
import { useState, useEffect } from 'react';
import { ArrowLeft, Users, BookOpen, Sparkles, Wand2, CheckCircle, FileText, Map as MapIcon, Save, FolderOpen, Trash2, Download, PenTool, X, RefreshCw, SlidersHorizontal, FilePlus2 } from 'lucide-react';
import { blueprintApi } from '../services/api';
import { DensityTuningKey, DensityTuningLevels, OutlineData } from '../types';
import { sortSavedMicroStoriesForChapters, useWorldSettings } from '../contexts/WorldSettingsContext';
import {
  buildDensityTuningSuggestion,
  DENSITY_TUNING_CONFIG,
  DENSITY_TUNING_KEYS,
  DENSITY_TUNING_MAX_LEVEL,
  emptyDensityLevels,
  extractRedFruitReview,
  normalizeDensityLevels,
} from '../utils/densityTuning';
import {
  getLogicModelRequestFromSources,
  toPreferredLogicModelFields,
} from '../utils/llmModelSelection';

/**
 * 将OutlineData格式化为大纲字符串
 */
function formatOutlineData(outline: OutlineData): string {
  const finalSection = outline.requiresSpecialPower === false
    ? ''
    : `\n金手指设定：\n${outline.themes}`;
  return `### ${outline.title}
${outline.aliasTitle ? `又名：${outline.aliasTitle}\n` : ''}${outline.aliasSynopsis ? `简介：${outline.aliasSynopsis}\n` : ''}${outline.aliasTags?.length ? `标签：${outline.aliasTags.join('、')}\n` : ''}

核心概念：
${outline.logline}

人物关系：
${outline.characters}

世界观设定：
${outline.world}

主要冲突：
${outline.hook}${finalSection}`;
}

function getOutlineBookName(outline?: OutlineData | null): string {
  return (outline?.aliasTitle || outline?.title || '').trim();
}

function hasMeaningfulOutline(outline?: OutlineData | null): outline is OutlineData {
  if (!outline) return false;
  return [
    outline.logline,
    outline.characters,
    outline.world,
    outline.hook,
    outline.requiresSpecialPower === false ? '' : outline.themes,
    outline.rawContent,
  ].some(value => Boolean((value || '').trim()));
}

/**
 * 清理Markdown格式符号，使内容更美观
 */
function cleanMarkdownFormatting(text: string): string {
  return text
    .replace(/^#+\s*/gm, '') // 移除标题符号
    .replace(/\*\*(.*?)\*\*/g, '$1') // 移除粗体符号
    .replace(/\*(.*?)\*/g, '$1') // 移除斜体符号
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/`(.*?)`/g, '$1') // 移除行内代码
    .replace(/^\s*[-*+]\s+/gm, '') // 移除列表符号
    .replace(/^\s*\d+\.\s+/gm, '') // 移除有序列表符号
    .replace(/^\s*>\s+/gm, '') // 移除引用符号
    .replace(/\n{3,}/g, '\n\n') // 压缩多余的换行
    .trim();
}

function cleanPublicOutlineMetadata(text: string): string {
  return String(text || '')
    .replace(/[（(][^（）()\n]*(?:桥段类型|爱情线一级结构|好感度|两人关系阶段|关系阶段|爱情线阶段|爱情线ID|承载中故事序号)[^（）()\n]*[）)]/g, '')
    .split('\n')
    .filter(line => !/^\s*(?:桥段类型|爱情线一级结构|好感度|两人关系阶段|关系阶段|爱情线阶段|爱情线ID|承载中故事序号)\s*[:：]/.test(line.trim()))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chineseNumberToInt(value: string): number {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const digitMap: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (normalized.includes('百')) {
    const [hundredsPart, restPart = ''] = normalized.split('百');
    const hundreds = digitMap[hundredsPart] || 1;
    const rest = restPart.startsWith('零') ? restPart.slice(1) : restPart;
    return hundreds * 100 + (rest ? chineseNumberToInt(rest) : 0);
  }
  if (normalized === '十') return 10;
  if (normalized.startsWith('十')) return 10 + (digitMap[normalized.slice(1)] || 0);
  if (normalized.includes('十')) {
    const [tens, ones] = normalized.split('十');
    return (digitMap[tens] || 1) * 10 + (digitMap[ones] || 0);
  }
  return digitMap[normalized] || 0;
}

function parseMacroStories(content: string): string[] {
  const boundaries = getOrderedMacroStoryBoundaries(content);
  return boundaries.map((currentMatch, index) => {
    const nextMatch = boundaries[index + 1];
    const startIndex = currentMatch.index! + currentMatch[0].length;
    const endIndex = nextMatch ? nextMatch.index! : content.length;
    return content.slice(startIndex, endIndex).trim();
  }).filter(Boolean);
}

function getOrderedMacroStoryBoundaries(content: string) {
  const storyRegex = /【中故事([一二三四五六七八九十百\d]+)】/g;
  const matches = [...String(content || '').matchAll(storyRegex)];
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
}

function getLastMacroStoryNumber(content: string): number {
  const storyRegex = /【中故事([一二三四五六七八九十百\d]+)】/g;
  return [...content.matchAll(storyRegex)].reduce((maxNumber, match) => {
    const storyNumber = chineseNumberToInt(match[1] || '');
    return storyNumber > maxNumber ? storyNumber : maxNumber;
  }, 0);
}

function replaceMacroStoriesByIndex(detailedOutline: string, replacements: Map<number, string>): string {
  const boundaries = getOrderedMacroStoryBoundaries(detailedOutline);
  if (boundaries.length === 0) return detailedOutline;

  let result = '';
  let cursor = 0;
  boundaries.forEach((match, orderedIndex) => {
    const nextMatch = boundaries[orderedIndex + 1];
    const startIndex = match.index!;
    const contentStart = startIndex + match[0].length;
    const contentEnd = nextMatch ? nextMatch.index! : detailedOutline.length;
    result += detailedOutline.slice(cursor, contentStart);
    result += replacements.has(orderedIndex)
      ? `\n${(replacements.get(orderedIndex) || '').trim()}\n`
      : detailedOutline.slice(contentStart, contentEnd);
    cursor = contentEnd;
  });

  result += detailedOutline.slice(cursor);
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function parseMacroStoryReplacementMap(content: string, fallbackIndexes: number[]): Map<number, string> {
  const boundaries = getOrderedMacroStoryBoundaries(content);
  const replacements = new Map<number, string>();

  if (boundaries.length === 0) {
    if (fallbackIndexes.length === 1 && content.trim()) {
      replacements.set(fallbackIndexes[0], content.trim());
    }
    return replacements;
  }

  boundaries.forEach((match, orderedIndex) => {
    const nextMatch = boundaries[orderedIndex + 1];
    const startIndex = match.index! + match[0].length;
    const endIndex = nextMatch ? nextMatch.index! : content.length;
    const storyNumber = match.storyNumber;
    const targetIndex = storyNumber > 0 ? storyNumber - 1 : fallbackIndexes[orderedIndex];
    if (fallbackIndexes.includes(targetIndex)) {
      replacements.set(targetIndex, content.slice(startIndex, endIndex).trim());
    }
  });

  return replacements;
}

interface WorldSettingPageProps {
  onBack: () => void;
  onNavigateToStructure: () => void;
  selectedOutline: OutlineData | null;
  isAutoFlowRunning?: boolean;
  setAutoFlowStep?: (step: string) => void;
  setAutoFlowProgress?: (progress: number) => void;
}

type OutlineMode = 'novel' | 'microdrama' | 'literature';

export function WorldSettingPage({ onBack, onNavigateToStructure, selectedOutline, isAutoFlowRunning, setAutoFlowStep, setAutoFlowProgress }: WorldSettingPageProps) {
  const { currentProject, createProject, updateProject, deleteProject, loadProject, clearCurrentProject, exportProject, exportAllProjects, importFromJsonText, pullCloudProjects, projects, clearNovelCacheForProject, clearNovelCacheForAllProjects } = useWorldSettings();
  const getLogicModelRequest = () =>
    getLogicModelRequestFromSources(currentProject, selectedOutline);
  const getPreferredLogicModelFields = () =>
    toPreferredLogicModelFields(getLogicModelRequest().llmModel);
  const [outlineMode, setOutlineMode] = useState<OutlineMode>('novel');
  const [microdramaEpisodeCount, setMicrodramaEpisodeCount] = useState<15 | 30 | 60 | 100>(15);
  const [reduceSensitiveContent, setReduceSensitiveContent] = useState(false);
  const [densityTuningLevels, setDensityTuningLevels] = useState<DensityTuningLevels>(emptyDensityLevels);
  const [densityDraftLevels, setDensityDraftLevels] = useState<DensityTuningLevels>(emptyDensityLevels);
  const [enabledDensityTunings, setEnabledDensityTunings] = useState<Record<DensityTuningKey, boolean>>({
    emotion: false,
    plot: false,
    element: false,
  });
  const [densityTuningLoading, setDensityTuningLoading] = useState(false);
  const [needsUpgradeSystem, setNeedsUpgradeSystem] = useState(true);
  const [useRealisticWorldview, setUseRealisticWorldview] = useState(false);
  const [realisticWorldviewContext, setRealisticWorldviewContext] = useState('');
  const [useEnglishNames, setUseEnglishNames] = useState(false);

  // 调试：监听项目状态变化
  useEffect(() => {
    console.log('WorldSettingPage - 当前项目状态:', currentProject ? {
      id: currentProject.id,
      name: currentProject.bookName,
      hasWorld: !!currentProject.worldSetting,
      hasChar: !!currentProject.characters,
      hasOutline: !!currentProject.detailedOutline
    } : '无当前项目');
  }, [currentProject]);

  const [worldSetting, setWorldSetting] = useState<string>('');
  const [characters, setCharacters] = useState<string>('');
  const [outline, setOutline] = useState<string>('');
  const [isPullingCloudProjects, setIsPullingCloudProjects] = useState(false);
  const [isGeneratingWorldSetting, setIsGeneratingWorldSetting] = useState(false);
  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isSupplementingOutline, setIsSupplementingOutline] = useState(false);
  const [supplementOutlineAsFinal, setSupplementOutlineAsFinal] = useState(false);
  const [isRegeneratingOutlineWithSuggestion, setIsRegeneratingOutlineWithSuggestion] = useState(false);
  const [isRefiningSelectedOutlineStories, setIsRefiningSelectedOutlineStories] = useState(false);
  const [selectedOutlineStoryIndexes, setSelectedOutlineStoryIndexes] = useState<number[]>([]);
  const [selectedOutlineRefineNote, setSelectedOutlineRefineNote] = useState('');
  const [outlineRevisionSuggestion, setOutlineRevisionSuggestion] = useState('');
  const [worldSettingGenerated, setWorldSettingGenerated] = useState(false);
  const [charactersGenerated, setCharactersGenerated] = useState(false);
  const [activeTab, setActiveTab] = useState<'world' | 'characters' | 'outline'>('world');

  // 批量生成相关状态
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{current: number, total: number, message: string} | null>(null);

  // 项目管理相关状态
  const [bookName, setBookName] = useState<string>('');
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [editingSection, setEditingSection] = useState<'world' | 'characters' | 'outline' | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<{ world: string; characters: string; outline: string }>({
    world: '',
    characters: '',
    outline: ''
  });
  const [inlineSaveSection, setInlineSaveSection] = useState<'world' | 'characters' | 'outline' | null>(null);
  const [supplementNotes, setSupplementNotes] = useState<{ world: string; characters: string }>({
    world: '',
    characters: ''
  });
  const [isSupplementingWorldSetting, setIsSupplementingWorldSetting] = useState(false);
  const [isSupplementingCharacters, setIsSupplementingCharacters] = useState(false);

  const outlineModeMeta = outlineMode === 'microdrama'
    ? {
        shortName: `微短剧${microdramaEpisodeCount}集`,
        buttonText: `生成微短剧${microdramaEpisodeCount}集大纲`,
        generateHint: microdramaEpisodeCount === 15
          ? '15集6个中故事：第1集单卡，2-3集一张卡，4-15集按3集连续卡推进'
          : microdramaEpisodeCount === 30
            ? '30集约7个中故事：1-2集、3-5集，其余每5集一个卡点'
            : microdramaEpisodeCount === 60
              ? '60集约13个中故事：1-2集、3-5集，其余每5集一个卡点'
              : '100集保留10个中故事卡点，每个卡点拆10集',
        resultTitle: `微短剧${microdramaEpisodeCount}集大纲结果`,
        emptyTitle: `尚未生成微短剧${microdramaEpisodeCount}集大纲`,
        emptyActionText: `手动填写微短剧${microdramaEpisodeCount}集大纲`,
      }
    : outlineMode === 'literature'
      ? {
          shortName: '文学作品细纲',
          buttonText: '生成文学作品细纲',
          generateHint: '文学作品固定10个中故事作为完整作品终点，降低网文味，强调人物命运、时代压力和主题余韵',
          resultTitle: '文学作品细纲结果',
          emptyTitle: '尚未生成文学作品细纲',
          emptyActionText: '手动填写文学作品细纲',
        }
    : {
        shortName: '网文情节细纲',
        buttonText: '生成首批10个中故事',
        generateHint: '网文按约40个中故事规划，每次生成10个；后续可在情节结构细化页继续生成下一批',
        resultTitle: '情节细纲结果',
        emptyTitle: '尚未生成情节细纲',
        emptyActionText: '手动填写情节细纲',
	      };

  const activeInspirationOutline = hasMeaningfulOutline(selectedOutline)
    ? selectedOutline
    : hasMeaningfulOutline(currentProject?.outline)
      ? currentProject!.outline
      : null;
  const canUseAIGeneration = Boolean(activeInspirationOutline);

  // 初始化项目名称 - 优先使用selectedOutline的标题
  useEffect(() => {
    if (selectedOutline) {
      // 每次进入人设与世界观界面，都应该使用当前选中的灵感标题作为书名
      setBookName(getOutlineBookName(selectedOutline));
    }
  }, [selectedOutline]);

  // 如果有当前项目，加载其内容
  useEffect(() => {
    if (currentProject) {
      console.log('正在加载项目内容:', currentProject.bookName);
      console.log('项目包含内容 - 世界观:', !!currentProject.worldSetting, '人物:', !!currentProject.characters, '情节:', !!currentProject.detailedOutline);

      // 总是加载当前项目的内容，无论selectedOutline是否匹配
      setBookName(currentProject.bookName);
      setWorldSetting(currentProject.worldSetting || '');
      setCharacters(currentProject.characters || '');
      setOutline(cleanPublicOutlineMetadata(currentProject.detailedOutline || ''));
      setWorldSettingGenerated(!!currentProject.worldSetting);
      setCharactersGenerated(!!currentProject.characters);
      setOutlineMode(
        currentProject.detailedOutlineMode === 'microdrama'
          ? 'microdrama'
          : currentProject.detailedOutlineMode === 'literature'
            ? 'literature'
            : 'novel'
      );
      setMicrodramaEpisodeCount(
        currentProject.microdramaEpisodeCount === 15 || currentProject.microdramaEpisodeCount === 30 || currentProject.microdramaEpisodeCount === 60 || currentProject.microdramaEpisodeCount === 100
          ? currentProject.microdramaEpisodeCount
          : 15
      );
      setReduceSensitiveContent(Boolean(currentProject.reduceSensitiveContent));
      const normalizedDensityLevels = normalizeDensityLevels(currentProject.densityTuningLevels);
      setDensityTuningLevels(normalizedDensityLevels);
      setDensityDraftLevels(normalizedDensityLevels);
      setEnabledDensityTunings({ emotion: false, plot: false, element: false });
      setNeedsUpgradeSystem(currentProject.worldSettingNeedsUpgradeSystem !== false);
      setUseRealisticWorldview(Boolean(currentProject.worldSettingUseRealisticMode));
      setRealisticWorldviewContext(currentProject.worldSettingRealisticContext || '');

      // 如果有内容，自动切换到对应的标签页
      if (currentProject.detailedOutline) {
        setActiveTab('outline');
      } else if (currentProject.characters) {
        setActiveTab('characters');
      } else if (currentProject.worldSetting) {
        setActiveTab('world');
      } else {
        setActiveTab('world');
      }

      console.log('项目内容加载完成');
    } else {
      console.log('没有当前项目，清空内容');
      // 没有当前项目，清空所有内容
      setWorldSetting('');
      setCharacters('');
      setOutline('');
      setWorldSettingGenerated(false);
      setCharactersGenerated(false);
      setActiveTab('world');
      setOutlineMode('novel');
      setNeedsUpgradeSystem(true);
      const emptyLevels = emptyDensityLevels();
      setDensityTuningLevels(emptyLevels);
      setDensityDraftLevels(emptyLevels);
      setEnabledDensityTunings({ emotion: false, plot: false, element: false });

      // 如果有selectedOutline，设置书名
      if (selectedOutline) {
        setBookName(getOutlineBookName(selectedOutline));
      }
    }

    // 切换项目时重置“单块编辑态”，避免编辑草稿串到其它项目
    setEditingSection(null);
  }, [currentProject]);

  // 检查自动化流程
  useEffect(() => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    if (autoFlowFlag === 'world-setting' && selectedOutline && bookName.trim()) {
      console.log('检测到自动化流程：开始自动执行一键生成全部设定');
      localStorage.removeItem('story-architect-auto-flow');

      // 更新自动化状态
      if (setAutoFlowStep) setAutoFlowStep('正在自动点击"一键生成全部设定"...');
      if (setAutoFlowProgress) setAutoFlowProgress(20);

      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        handleBatchGenerate();
      }, 1000);
    }
  }, [selectedOutline, bookName, setAutoFlowStep, setAutoFlowProgress]);

  // 单独处理selectedOutline的变化（当没有当前项目时）
  useEffect(() => {
    if (!currentProject && selectedOutline) {
      setBookName(getOutlineBookName(selectedOutline));
    }
  }, [selectedOutline, currentProject]);

  const handleGenerateWorldSetting = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }
    if (!validateRealisticWorldviewInput()) return;

    setIsGeneratingWorldSetting(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);

      const response = await blueprintApi.generateWorldSetting({
        ...getLogicModelRequest(),
        outline: outlineData,
        ...getWorldSettingGenerationOptions(),
      });

      console.log('生成的世界观基础设定:', response.data);
      setWorldSetting(response.data);
      setWorldSettingGenerated(true);
    } catch (error) {
      console.error('生成世界观基础设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '生成世界观基础设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsGeneratingWorldSetting(false);
    }
  };

  const handleGenerateCharacters = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    setIsGeneratingCharacters(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);

      const response = await blueprintApi.generateCharacters({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting: worldSetting,
        useEnglishNames,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
      });

      console.log('生成的人物数据:', response.data);
      setCharacters(response.data);
      setCharactersGenerated(true);
    } catch (error) {
      console.error('生成人物失败:', error);
      alert('生成人物失败，请稍后重试');
    } finally {
      setIsGeneratingCharacters(false);
    }
  };

  const handleSupplementWorldSetting = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    const note = supplementNotes.world.trim();
    if (!worldSetting.trim()) {
      alert('请先生成或填写世界观基础设定');
      return;
    }
    if (!note) {
      alert('请先填写要补充的批注');
      return;
    }
    if (!validateRealisticWorldviewInput()) return;

    setIsSupplementingWorldSetting(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateWorldSetting({
        ...getLogicModelRequest(),
        outline: outlineData,
        ...getWorldSettingGenerationOptions(),
        existingWorldSetting: worldSetting,
        note,
      });

      setWorldSetting(response.data);
      setWorldSettingGenerated(true);
      setSupplementNotes(prev => ({ ...prev, world: '' }));

      if (currentProject) {
        updateProject(currentProject.id, {
          worldSetting: response.data,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
          worldSettingUseRealisticMode: useRealisticWorldview,
          worldSettingRealisticContext: realisticWorldviewContext,
        });
      }

      setInlineSaveSection('world');
      setTimeout(() => setInlineSaveSection(null), 1500);
    } catch (error) {
      console.error('补充世界观基础设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '补充世界观基础设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsSupplementingWorldSetting(false);
    }
  };

  const handleSupplementCharacters = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    const note = supplementNotes.characters.trim();
    if (!characters.trim()) {
      alert('请先生成或填写人物设定');
      return;
    }
    if (!note) {
      alert('请先填写要补充的批注');
      return;
    }

    setIsSupplementingCharacters(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateCharacters({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting,
        useEnglishNames,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        existingCharacters: characters,
        note,
      });

      setCharacters(response.data);
      setCharactersGenerated(true);
      setSupplementNotes(prev => ({ ...prev, characters: '' }));

      if (currentProject) {
        updateProject(currentProject.id, {
          characters: response.data,
        });
      }

      setInlineSaveSection('characters');
      setTimeout(() => setInlineSaveSection(null), 1500);
    } catch (error) {
      console.error('补充人物设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '补充人物设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsSupplementingCharacters(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    setIsGeneratingOutline(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);

      const response = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting: worldSetting,
        characters: characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: '',
      });

      const cleanedOutline = cleanPublicOutlineMetadata(response.data);
      console.log('生成的情节细纲:', cleanedOutline);
      setOutline(cleanedOutline);
      const resetDensityLevels = emptyDensityLevels();
      setDensityTuningLevels(resetDensityLevels);
      setDensityDraftLevels(resetDensityLevels);
      setEnabledDensityTunings({ emotion: false, plot: false, element: false });
    } catch (error) {
      console.error('生成情节细纲失败:', error);
      alert('生成情节细纲失败，请稍后重试');
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const handleSupplementOutlineBatch = async () => {
    if (outlineMode !== 'novel') {
      alert('增补中故事目前只用于网文情节细纲');
      return;
    }
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }
    if (!worldSetting || !characters) {
      alert('请先生成世界观和人物设定');
      return;
    }
    if (!outline.trim()) {
      alert('请先生成首批10个中故事');
      return;
    }

    const existingCount = parseMacroStories(outline).length;
    if (existingCount <= 0) {
      alert('未检测到已有中故事，请先生成首批10个中故事');
      return;
    }

    const lastStoryNumber = getLastMacroStoryNumber(outline);
    const startNumber = lastStoryNumber > 0 ? lastStoryNumber + 1 : existingCount + 1;
    const endNumber = startNumber + 9;
    const nextBatchIndex = Math.floor((startNumber - 1) / 10) + 1;

    setIsSupplementingOutline(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting,
        characters,
        mode: 'novel',
        reduceSensitiveContent,
        outlineBatchIndex: nextBatchIndex,
        outlineStartNumber: startNumber,
        existingDetailedOutline: outline,
        isFinalBatch: supplementOutlineAsFinal,
      });

      const cleanedSupplement = cleanPublicOutlineMetadata(response.data);
      const nextOutline = [outline.trim(), cleanedSupplement.trim()].filter(Boolean).join('\n\n');
      setOutline(nextOutline);
      setActiveTab('outline');

      if (currentProject) {
        updateProject(currentProject.id, {
          detailedOutline: nextOutline,
          detailedOutlineMode: 'novel',
          reduceSensitiveContent,
        });
      }

      alert(`已增补【中故事${startNumber}】到【中故事${endNumber}】。`);
    } catch (error) {
      console.error('增补中故事失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '增补中故事失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsSupplementingOutline(false);
    }
  };

  const handleImportOutlineSuggestion = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setOutlineRevisionSuggestion(text.trim());
    } catch (error) {
      console.error('读取情节建议文件失败:', error);
      alert('读取建议文件失败，请改为直接粘贴文本');
    }
  };

  const handleRegenerateOutlineWithSuggestion = async () => {
    if (!activeInspirationOutline) {
      alert('未找到故事大纲，请返回第一步重新选择或加载项目');
      return;
    }
    if (!worldSetting || !characters || !outline) {
      alert('请先准备好世界观基础设定、人物设定和当前情节细纲');
      return;
    }
    if (!outlineRevisionSuggestion.trim()) {
      alert('请先粘贴或导入修改建议');
      return;
    }

    const confirmed = confirm('将基于当前情节细纲、世界观、人设和导入建议，完整重生成所有中故事。新结果会覆盖当前情节细纲，确定继续吗？');
    if (!confirmed) return;

    setIsRegeneratingOutlineWithSuggestion(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting,
        characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: outline,
        outlineRevisionSuggestion: outlineRevisionSuggestion.trim(),
      });

      const cleanedOutline = cleanPublicOutlineMetadata(response.data);
      setOutline(cleanedOutline);
      setActiveTab('outline');

      if (currentProject) {
        updateProject(currentProject.id, {
          detailedOutline: cleanedOutline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
        });
      }

      alert('已根据导入建议重生成情节细纲。');
    } catch (error) {
      console.error('根据建议重生成情节细纲失败:', error);
      alert('根据建议重生成情节细纲失败，请稍后重试');
    } finally {
      setIsRegeneratingOutlineWithSuggestion(false);
    }
  };

  const toggleSelectedOutlineStory = (index: number) => {
    setSelectedOutlineStoryIndexes(prev => {
      if (prev.includes(index)) {
        return prev.filter(item => item !== index);
      }
      if (prev.length >= 5) {
        alert('一次最多选择5个中故事做局部细化');
        return prev;
      }
      return [...prev, index].sort((a, b) => a - b);
    });
  };

  const handleRefineSelectedOutlineStories = async () => {
    if (!activeInspirationOutline) {
      alert('未找到故事大纲，请返回第一步重新选择或加载项目');
      return;
    }
    if (!worldSetting || !characters || !outline) {
      alert('请先准备好世界观基础设定、人物设定和当前情节细纲');
      return;
    }
    if (selectedOutlineStoryIndexes.length < 1 || selectedOutlineStoryIndexes.length > 5) {
      alert('请选择1到5个中故事进行局部细化');
      return;
    }

    setIsRefiningSelectedOutlineStories(true);
    try {
      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting,
        characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        existingDetailedOutline: outline,
        outlineRevisionSuggestion: selectedOutlineRefineNote.trim() || '按三密度滑块迭代方式局部强化：详细剧情更足，冲突更密，人物弧线更清晰，结尾钩子更强。',
        partialOutlineTargetIndexes: selectedOutlineStoryIndexes,
      });

      const cleanedResult = cleanPublicOutlineMetadata(response.data);
      const replacements = parseMacroStoryReplacementMap(cleanedResult, selectedOutlineStoryIndexes);
      if (replacements.size === 0) {
        alert('AI没有返回可识别的中故事编号，请重试一次');
        return;
      }

      const nextOutline = replaceMacroStoriesByIndex(outline, replacements);
      setOutline(nextOutline);
      setSelectedOutlineStoryIndexes([]);
      setSelectedOutlineRefineNote('');

      if (currentProject) {
        updateProject(currentProject.id, {
          detailedOutline: nextOutline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
        });
      }

      alert(`已局部细化 ${replacements.size} 个中故事。`);
    } catch (error) {
      console.error('局部细化中故事失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '局部细化中故事失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsRefiningSelectedOutlineStories(false);
    }
  };

  const setDensityTuningEnabled = (key: DensityTuningKey, enabled: boolean) => {
    setEnabledDensityTunings(prev => ({ ...prev, [key]: enabled }));
    setDensityDraftLevels(prev => ({
      ...prev,
      [key]: enabled
        ? Math.min(DENSITY_TUNING_MAX_LEVEL, densityTuningLevels[key] + 1)
        : densityTuningLevels[key],
    }));
  };

  const setDensityDraftLevel = (key: DensityTuningKey, rawValue: number) => {
    const currentLevel = densityTuningLevels[key];
    const nextLevel = Math.min(DENSITY_TUNING_MAX_LEVEL, currentLevel + 1);
    const clamped = Math.min(nextLevel, Math.max(currentLevel, Math.floor(rawValue)));
    setDensityDraftLevels(prev => ({ ...prev, [key]: clamped }));
  };

  const hasActiveDensityTuning = DENSITY_TUNING_KEYS.some(
    key => enabledDensityTunings[key] && densityDraftLevels[key] > densityTuningLevels[key]
  );

  const handleTuneDetailedOutlineDensity = async () => {
    if (!activeInspirationOutline) {
      alert('未找到故事大纲，请返回第一步重新选择或加载项目');
      return;
    }
    if (!worldSetting || !characters || !outline) {
      alert('请先准备好世界观基础设定、人物设定和当前情节细纲');
      return;
    }
    if (!hasActiveDensityTuning) {
      alert('请至少勾选一个滑块，并向上提升一档');
      return;
    }

    setDensityTuningLoading(true);
    try {
      const nextLevels: DensityTuningLevels = { ...densityTuningLevels };
      DENSITY_TUNING_KEYS.forEach(key => {
        if (enabledDensityTunings[key] && densityDraftLevels[key] > densityTuningLevels[key]) {
          nextLevels[key] = densityDraftLevels[key];
        }
      });

      const outlineData = formatOutlineData(activeInspirationOutline);
      const response = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting,
        characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent: true,
        existingDetailedOutline: outline,
        outlineRevisionSuggestion: buildDensityTuningSuggestion(
          densityTuningLevels,
          nextLevels,
          enabledDensityTunings,
          outlineMode,
        ),
      });

      const cleanedOutline = cleanPublicOutlineMetadata(response.data);
      setOutline(cleanedOutline);
      setActiveTab('outline');
      setReduceSensitiveContent(true);
      setDensityTuningLevels(nextLevels);
      setDensityDraftLevels(nextLevels);
      setEnabledDensityTunings({ emotion: false, plot: false, element: false });

      if (currentProject) {
        const newStories = parseMacroStories(cleanedOutline);
        const saved = currentProject.savedMicroStories || [];
        const updatedSaved = saved.map(story => {
          const macroIndex = Number(story.macroStoryId.replace('story_', ''));
          return Number.isFinite(macroIndex) && newStories[macroIndex]
            ? { ...story, macroStoryContent: newStories[macroIndex] }
            : story;
        });
        const selected = currentProject.selectedMicroStories;
        const updatedSelected = selected
          ? selected.map(story => {
              const macroIndex = Number(story.macroStoryId.replace('story_', ''));
              return Number.isFinite(macroIndex) && newStories[macroIndex]
                ? { ...story, macroStoryContent: newStories[macroIndex] }
                : story;
            })
          : undefined;

        updateProject(currentProject.id, {
          detailedOutline: cleanedOutline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          densityTuningLevels: nextLevels,
          reduceSensitiveContent: true,
          microStoryOutlines: {},
          savedMicroStories: sortSavedMicroStoriesForChapters(updatedSaved),
          ...(updatedSelected ? { selectedMicroStories: updatedSelected } : {}),
        });
      }

      alert('三密度滑块迭代完成，已在本页更新完整情节细纲。');
    } catch (error) {
      console.error('三密度滑块迭代失败:', error);
      alert('三密度滑块迭代失败，请稍后重试');
    } finally {
      setDensityTuningLoading(false);
    }
  };

  const getActiveOutline = (): OutlineData | null => selectedOutline || currentProject?.outline || null;

  const validateRealisticWorldviewInput = () => {
    if (!useRealisticWorldview) return true;
    if (realisticWorldviewContext.trim()) return true;
    alert('请先填写现实主义世界观背景，比如“上世纪80年代东北县城”或“1990年代广州服装批发市场”。');
    return false;
  };

  const getWorldSettingGenerationOptions = () => ({
    needsUpgradeSystem: useRealisticWorldview ? false : needsUpgradeSystem,
    targetMode: outlineMode,
    microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
    useRealisticWorldview,
    realisticWorldviewContext: useRealisticWorldview ? realisticWorldviewContext.trim() : undefined,
  });

  const hasAnyDraftContent = () =>
    Boolean(bookName.trim() || worldSetting.trim() || characters.trim() || outline.trim());

  const hasUnsavedProjectContent = () => {
    if (!hasAnyDraftContent()) return false;
    if (!currentProject) return true;

    return (
      currentProject.bookName !== bookName.trim() ||
      (currentProject.worldSetting || '') !== worldSetting ||
      (currentProject.characters || '') !== characters ||
      (currentProject.detailedOutline || '') !== outline ||
      (currentProject.detailedOutlineMode || 'novel') !== outlineMode ||
      currentProject.microdramaEpisodeCount !== (outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined) ||
      Boolean(currentProject.reduceSensitiveContent) !== reduceSensitiveContent ||
      (currentProject.worldSettingNeedsUpgradeSystem !== false) !== needsUpgradeSystem ||
      Boolean(currentProject.worldSettingUseRealisticMode) !== useRealisticWorldview ||
      (currentProject.worldSettingRealisticContext || '') !== realisticWorldviewContext
    );
  };

  const saveCurrentProject = (options: { requireComplete?: boolean; quiet?: boolean } = {}) => {
    const activeOutline = getActiveOutline();
    const resolvedBookName = bookName.trim() || getOutlineBookName(activeOutline) || currentProject?.bookName || '未命名项目';

    if (!activeOutline) {
      if (!options.quiet) {
        alert('未找到选中的故事大纲，请返回第一步重新选择');
      }
      return false;
    }

    if (options.requireComplete && (!worldSetting.trim() || !characters.trim() || !outline.trim())) {
      alert('请先生成完整的世界观基础设定、人物设定和情节细纲后再保存');
      return false;
    }

    try {
      console.log('开始保存项目，当前项目状态:', currentProject ? '存在' : '不存在');
      console.log('书名:', resolvedBookName);
      console.log('世界观基础设定长度:', worldSetting.length);
      console.log('人物设定长度:', characters.length);
      console.log('情节细纲长度:', outline.length);

      if (currentProject) {
        console.log('更新现有项目，项目ID:', currentProject.id);
        // 更新现有项目
        updateProject(currentProject.id, {
          bookName: resolvedBookName,
          worldSetting,
          characters,
          detailedOutline: outline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          densityTuningLevels,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
          worldSettingUseRealisticMode: useRealisticWorldview,
          worldSettingRealisticContext: realisticWorldviewContext,
          ...getPreferredLogicModelFields(),
        });
      } else {
        console.log('创建新项目');
        // 创建新项目，包含所有生成的内容
        const newProject = createProject(resolvedBookName, activeOutline, {
          worldSetting,
          characters,
          detailedOutline: outline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          densityTuningLevels,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
          worldSettingUseRealisticMode: useRealisticWorldview,
          worldSettingRealisticContext: realisticWorldviewContext,
          ...getPreferredLogicModelFields(),
        });
        console.log('新项目创建完成，项目ID:', newProject.id);
      }

      if (!options.quiet) {
        setShowSaveConfirm(true);
        setTimeout(() => setShowSaveConfirm(false), 2000);
      }
      return true;
    } catch (error) {
      console.error('保存项目失败:', error);
      if (!options.quiet) {
        alert('保存项目失败，请稍后重试');
      }
      return false;
    }
  };

  // 保存项目
  const handleSaveProject = () => {
    saveCurrentProject({ requireComplete: true });
  };

  const handleCreateNewProject = () => {
    if (hasAnyDraftContent()) {
      const saved = saveCurrentProject({ requireComplete: false, quiet: true });
      if (!saved) {
        alert('当前内容保存失败，已取消新建项目，避免丢失草稿。');
        return;
      }
    }

    clearCurrentProject();
    localStorage.removeItem('story-architect-current-outline');
    onBack();
  };

  const handleNavigateToStructure = () => {
    if (hasUnsavedProjectContent()) {
      const confirmed = confirm('检测到当前世界观、人设或情节细纲还没有保存。点击“确定”会先保存项目再进入情节结构细化；点击“取消”将留在本页。');
      if (!confirmed) return;

      const saved = saveCurrentProject({ requireComplete: true });
      if (!saved) return;
    }

    if (!currentProject && !hasUnsavedProjectContent()) {
      const saved = saveCurrentProject({ requireComplete: true });
      if (!saved) return;
    }

    onNavigateToStructure();
  };

  // 加载项目
  const handleLoadProject = (project: any) => {
    loadProject(project);
    setShowProjectPanel(false);
  };

  // 删除项目
  const handleDeleteProject = (projectId: number) => {
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      deleteProject(projectId);
    }
  };

  const handleClearNovelCacheForAll = () => {
    if (projects.length === 0) {
      alert('当前没有任何项目，无需清理。');
      return;
    }
    const confirmed = confirm('确定要清空【所有项目】已生成的小说正文缓存吗？\n\n这会删除：\n- 正文已生成章节\n- 正文版本历史\n- Writer 临时进度\n- auto_gen_* 临时缓存\n\n但会保留：\n- 世界观/人物/情节细纲\n- 小故事/选择的小故事等设定\n\n此操作不可恢复（建议先导出备份）。');
    if (!confirmed) return;
    clearNovelCacheForAllProjects();
    alert('已清空所有项目的正文缓存。');
  };

  const handleClearNovelCacheForOne = (projectId: number, bookName: string) => {
    const confirmed = confirm(`确定要清空《${bookName}》的已生成正文缓存吗？\n\n这会删除：\n- 正文已生成章节\n- 正文版本历史\n- Writer 临时进度\n\n但会保留世界观/人物/大纲/小故事等设定。\n\n此操作不可恢复（建议先导出备份）。`);
    if (!confirmed) return;
    clearNovelCacheForProject(projectId);
    alert(`已清空《${bookName}》的正文缓存。`);
  };

  const handleImportProjectFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = importFromJsonText(text);
      if (result.imported === 0) {
        alert('导入失败：未识别到可用的项目数据（请确认选择的是导出的 JSON 文件）');
        return;
      }
      const skippedMsg = result.skipped > 0 ? `（跳过 ${result.skipped} 条无效数据）` : '';
      alert(`导入成功：已导入 ${result.imported} 个项目${skippedMsg}\n\n提示：已自动加载最新导入的项目，并尽力恢复正文进度。`);
    } catch (error) {
      console.error('导入项目失败:', error);
      alert('导入失败：读取或解析文件出错，请稍后重试');
    }
  };

  const handlePullCloudProjects = async () => {
    setIsPullingCloudProjects(true);
    try {
      const result = await pullCloudProjects(true);
      alert(`云端项目已拉取：当前共有 ${result.total} 个项目。`);
    } catch (error) {
      console.error('拉取云端项目失败:', error);
      alert('拉取云端项目失败，请确认激活码和网络后重试。');
    } finally {
      setIsPullingCloudProjects(false);
    }
  };

  // 检查是否可以保存
  const canSave = Boolean(getActiveOutline() && bookName.trim() && worldSetting && characters && outline);
  const redFruitReview = extractRedFruitReview(outline);

  const startEditSection = (section: 'world' | 'characters' | 'outline') => {
    const currentValue =
      section === 'world'
        ? worldSetting
        : section === 'characters'
          ? characters
          : outline;

    setSectionDrafts(prev => ({ ...prev, [section]: currentValue }));
    setEditingSection(section);
  };

  const cancelEditSection = () => {
    setEditingSection(null);
  };

  const saveEditedSection = (section: 'world' | 'characters' | 'outline') => {
    const nextValue = sectionDrafts[section] ?? '';

    if (section === 'world') {
      setWorldSetting(nextValue);
      setWorldSettingGenerated(!!nextValue.trim());
    } else if (section === 'characters') {
      setCharacters(nextValue);
      setCharactersGenerated(!!nextValue.trim());
    } else {
      setOutline(nextValue);
    }

    if (currentProject) {
      updateProject(currentProject.id, {
        ...(section === 'world' ? { worldSetting: nextValue } : {}),
        ...(section === 'characters' ? { characters: nextValue } : {}),
        ...(section === 'outline' ? { detailedOutline: nextValue } : {}),
      });
    }

    setEditingSection(null);
    setInlineSaveSection(section);
    setTimeout(() => setInlineSaveSection(null), 1500);
  };

  // 一键批量生成世界观、人物、情节设定
  const handleBatchGenerate = async () => {
    if (!activeInspirationOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    if (!bookName.trim()) {
      alert('请输入书名');
      return;
    }
    if (!validateRealisticWorldviewInput()) return;

    setBatchGenerating(true);
    setBatchGenerationProgress({ current: 1, total: 4, message: '正在生成世界观基础设定...' });
    localStorage.removeItem('story-architect-auto-flow');

    // 更新自动化状态
    if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成世界观基础设定...');
    if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(30);

    try {
      // 第一步：生成世界观基础设定
      const outlineData = formatOutlineData(activeInspirationOutline);
      const worldResponse = await blueprintApi.generateWorldSetting({
        ...getLogicModelRequest(),
        outline: outlineData,
        ...getWorldSettingGenerationOptions(),
      });

      console.log('批量生成：世界观基础设定成功');
      setWorldSetting(worldResponse.data);
      setWorldSettingGenerated(true);
      setBatchGenerationProgress({ current: 2, total: 4, message: '正在生成人物设定...' });

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成人物设定...');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(50);

      // 第二步：生成人物设定
      const charactersResponse = await blueprintApi.generateCharacters({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting: worldResponse.data,
        useEnglishNames,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
      });

      console.log('批量生成：人物设定成功');
      setCharacters(charactersResponse.data);
      setCharactersGenerated(true);
      setBatchGenerationProgress({ current: 3, total: 4, message: '正在生成情节细纲...' });

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成情节细纲...');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(70);

      // 第三步：生成情节细纲
      const outlineResponse = await blueprintApi.generateDetailedOutline({
        ...getLogicModelRequest(),
        outline: outlineData,
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: '',
      });

      console.log('批量生成：情节细纲成功');
      const cleanedOutline = cleanPublicOutlineMetadata(outlineResponse.data);
      setOutline(cleanedOutline);
      const resetDensityLevels = emptyDensityLevels();
      setDensityTuningLevels(resetDensityLevels);
      setDensityDraftLevels(resetDensityLevels);
      setEnabledDensityTunings({ emotion: false, plot: false, element: false });
      setBatchGenerationProgress({ current: 4, total: 4, message: '正在自动保存项目...' });

      // 第四步：自动保存项目
      if (currentProject) {
        updateProject(currentProject.id, {
          bookName: bookName.trim(),
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          detailedOutline: cleanedOutline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          densityTuningLevels: resetDensityLevels,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
          worldSettingUseRealisticMode: useRealisticWorldview,
          worldSettingRealisticContext: realisticWorldviewContext,
          ...getPreferredLogicModelFields(),
        });
      } else {
        const newProject = createProject(bookName.trim(), activeInspirationOutline, {
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          detailedOutline: cleanedOutline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          densityTuningLevels: resetDensityLevels,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
          worldSettingUseRealisticMode: useRealisticWorldview,
          worldSettingRealisticContext: realisticWorldviewContext,
          ...getPreferredLogicModelFields(),
        });
        console.log('批量生成：新项目创建完成，项目ID:', newProject.id);
      }

      setBatchGenerationProgress({ current: 4, total: 4, message: '保存完成' });
      setActiveTab('outline');

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('世界观、人设与中故事已生成完成');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(100);

      console.log('批量生成完成，停留在人设与世界观页面');

    } catch (error) {
      console.error('批量生成失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '批量生成过程中出现错误，请稍后重试';
      alert(errorMessage);
    } finally {
      setBatchGenerating(false);
      setBatchGenerationProgress(null);
    }
  };

  const renderDensityTuningPanel = () => {
    if (!outline || editingSection === 'outline') return null;

    return (
      <div className="mt-4 border border-primary-100 bg-white rounded-lg p-4 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <SlidersHorizontal className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-secondary-900">三密度滑块迭代器</div>
              <div className="text-xs text-secondary-600 mt-1">
                勾选后每轮只能向上提升一档，单项最高5档；重写完成后下方完整细纲会直接更新。
              </div>
            </div>
          </div>

	          <button
	            onClick={handleTuneDetailedOutlineDensity}
	            disabled={densityTuningLoading || !hasActiveDensityTuning || !canUseAIGeneration}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
            title="把当前完整情节细纲和滑块建议发送给AI，重写所有中故事"
          >
            {densityTuningLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {densityTuningLoading ? '迭代中...' : '按滑块重写完整细纲'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {DENSITY_TUNING_KEYS.map(key => {
            const config = DENSITY_TUNING_CONFIG[key];
            const currentLevel = densityTuningLevels[key];
            const nextLevel = Math.min(DENSITY_TUNING_MAX_LEVEL, currentLevel + 1);
            const isEnabled = enabledDensityTunings[key] && currentLevel < DENSITY_TUNING_MAX_LEVEL;
            const draftLevel = densityDraftLevels[key];

            return (
              <div key={key} className="rounded-lg border border-secondary-200 bg-secondary-50/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-center space-x-2 cursor-pointer">
	                    <input
	                      type="checkbox"
	                      checked={enabledDensityTunings[key]}
	                      disabled={densityTuningLoading || currentLevel >= DENSITY_TUNING_MAX_LEVEL || !canUseAIGeneration}
                      onChange={(e) => setDensityTuningEnabled(key, e.target.checked)}
                      className="w-4 h-4 text-primary-600 rounded border-secondary-300 focus:ring-primary-500"
                    />
                    <span className="text-sm font-semibold text-secondary-900">{config.title}</span>
                  </label>
                  <span className="text-xs font-medium text-primary-700 bg-primary-100 px-2 py-1 rounded">
                    {currentLevel}/{DENSITY_TUNING_MAX_LEVEL}
                  </span>
                </div>

                <p className="text-xs text-secondary-500 mt-2 min-h-[32px]">{config.description}</p>

                <input
                  type="range"
                  min={currentLevel}
                  max={nextLevel}
                  step={1}
	                  value={draftLevel}
	                  disabled={!isEnabled || densityTuningLoading || !canUseAIGeneration}
                  onChange={(e) => setDensityDraftLevel(key, Number(e.target.value))}
                  className="w-full accent-primary-600 disabled:opacity-40 mt-3"
                />

                <div className="flex items-center justify-between text-xs text-secondary-500 mt-1">
                  <span>当前 {currentLevel}档</span>
                  <span>{currentLevel >= DENSITY_TUNING_MAX_LEVEL ? '已满档' : `本轮最多 ${nextLevel}档`}</span>
                </div>
                <div className="mt-2 text-xs text-secondary-600">
                  {enabledDensityTunings[key] && draftLevel > currentLevel
                    ? `${config.shortLabel}本轮提升到 ${draftLevel}档`
                    : '勾选后自动提升一档'}
                </div>
              </div>
            );
          })}
        </div>

        {redFruitReview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-sm font-semibold text-amber-900 mb-2">最近一次红果核心维度复盘</div>
            <div className="text-xs text-amber-900/80 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
              {redFruitReview}
            </div>
          </div>
        )}
      </div>
    );
  };

  const outlineMacroStoryCount = outlineMode === 'novel' ? parseMacroStories(outline).length : 0;
  const outlineStoryContents = outline ? parseMacroStories(outline) : [];
  const lastMacroStoryNumber = outlineMode === 'novel' ? getLastMacroStoryNumber(outline) : 0;
  const nextSupplementStart = lastMacroStoryNumber > 0 ? lastMacroStoryNumber + 1 : outlineMacroStoryCount + 1;
  const nextSupplementEnd = nextSupplementStart + 9;

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={onBack}
                className="p-2 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-secondary-600" />
              </button>
              <div className="p-2 bg-primary-100 rounded-lg">
                <Users className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-secondary-900">人设与世界观</h1>
                <p className="text-sm text-secondary-600">构建完整的世界与人物体系</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 项目管理区域 */}
              <div className="flex items-center space-x-3">
                {/* 书名输入 */}
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-secondary-700">书名:</label>
                  <input
                    type="text"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    placeholder="请输入书名"
                    className="px-3 py-1 text-sm border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                {/* 保存按钮 */}
                <button
                  onClick={handleSaveProject}
                  disabled={!canSave}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    showSaveConfirm
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : canSave
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-secondary-300 text-secondary-500 cursor-not-allowed'
                  }`}
                >
                  {showSaveConfirm ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>已保存</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>保存项目</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleCreateNewProject}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-md text-sm font-medium hover:bg-emerald-200 transition-colors"
                  title="先保存当前内容，再回到灵感架构页新建项目"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>新建项目</span>
                </button>

                {/* 项目列表按钮 */}
                <button
                  onClick={() => setShowProjectPanel(true)}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm font-medium hover:bg-secondary-200 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>我的项目 ({projects.length})</span>
                </button>
              </div>

              <div className="flex items-center space-x-2 text-secondary-600">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm">Powered by ZeeLin</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧配置面板 */}
          <div className="lg:col-span-4 space-y-6">
            {!canUseAIGeneration && (
              <div className="card p-5 border-amber-200 bg-amber-50 text-amber-800">
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">未引用灵感架构</div>
                    <p className="mt-1 text-xs leading-relaxed">
                      当前项目没有可供 AI 参考的灵感架构，左侧 AI 生成入口已停用。你仍然可以在右侧手动填写世界观、人物和情节细纲。
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <MapIcon className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">世界观基础设定</h2>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-secondary-200 bg-secondary-50 p-4">
                  <div className="text-sm font-medium text-secondary-900 mb-3">升级体系选项</div>
                  <div className="flex flex-wrap gap-3">
	                    <button
	                      onClick={() => {
                          setNeedsUpgradeSystem(true);
                          setUseRealisticWorldview(false);
                        }}
	                      disabled={!canUseAIGeneration || useRealisticWorldview}
	                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
	                        needsUpgradeSystem
	                          ? 'bg-primary-600 text-white shadow-sm'
	                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                      } disabled:opacity-50 disabled:cursor-not-allowed`}
	                    >
                      需要升级体系
                    </button>
	                    <button
	                      onClick={() => setNeedsUpgradeSystem(false)}
	                      disabled={!canUseAIGeneration || useRealisticWorldview}
	                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
	                        !needsUpgradeSystem
	                          ? 'bg-primary-600 text-white shadow-sm'
	                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                      } disabled:opacity-50 disabled:cursor-not-allowed`}
	                    >
                      不需要升级体系
                    </button>
                  </div>
                  <p className="text-xs text-secondary-600 mt-3">
                    都市、现代、现实、豪门、职场、校园等题材，建议关闭修炼升级体系，改走现实向世界观模板。
                  </p>
                </div>
                <div className="rounded-lg border border-secondary-200 bg-white p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={useRealisticWorldview}
                      disabled={!canUseAIGeneration}
                      onChange={(e) => {
                        setUseRealisticWorldview(e.target.checked);
                        if (e.target.checked) setNeedsUpgradeSystem(false);
                      }}
                      className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                    />
                    <span>
                      <span className="block text-sm font-medium text-secondary-900">生成现实主义世界观</span>
                      <span className="mt-1 block text-xs text-secondary-600">
                        适合年代、地域、家庭伦理、现实成长、社会变迁、职场商战等题材；开启后不会网文化、玄幻化或强行设计升级体系。
                      </span>
                    </span>
                  </label>
                  {useRealisticWorldview && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-secondary-600 mb-1">
                        现实背景字段
                      </label>
                      <textarea
                        value={realisticWorldviewContext}
                        onChange={(e) => setRealisticWorldviewContext(e.target.value)}
                        rows={3}
                        disabled={!canUseAIGeneration}
                        placeholder="例如：上世纪80年代东北县城；1990年代广州服装批发市场；2008年前后深圳互联网创业圈"
                        className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm disabled:bg-secondary-50"
                      />
                    </div>
                  )}
                </div>
	                <button
	                  onClick={handleGenerateWorldSetting}
	                  disabled={isGeneratingWorldSetting || !canUseAIGeneration}
	                  className="w-full btn btn-primary py-3 disabled:opacity-50"
	                >
                  {isGeneratingWorldSetting ? '生成中...' : '生成世界观设定'}
                </button>
                <p className="text-xs text-secondary-600">
                  {useRealisticWorldview
                    ? '生成符合指定年代、地域、社会结构与生活细节的现实主义世界观'
                    : '生成升级体系、地图布局、各大势力介绍等世界观基础元素'}
                </p>
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  可支撑前200章的故事内容
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <Wand2 className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">AI生成人物</h2>
              </div>

              <div className="space-y-4">
                <label className="flex items-start gap-3 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-3 text-sm text-secondary-700">
	                  <input
	                    type="checkbox"
	                    checked={useEnglishNames}
	                    onChange={(e) => setUseEnglishNames(e.target.checked)}
	                    disabled={!canUseAIGeneration}
	                    className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
	                  />
                  <span>
                    <span className="font-medium text-secondary-900">生成英文人物</span>
                    <span className="mt-1 block text-xs text-secondary-600">
                      使用欧美英文名，并排除华裔、俄裔角色设定
                    </span>
                  </span>
                </label>

	                <button
	                  onClick={handleGenerateCharacters}
	                  disabled={isGeneratingCharacters || !worldSettingGenerated || !canUseAIGeneration}
	                  className={`w-full py-3 disabled:opacity-50 ${
	                    worldSettingGenerated && canUseAIGeneration
	                      ? 'btn btn-primary'
	                      : 'btn btn-secondary cursor-not-allowed bg-secondary-300 hover:bg-secondary-300'
                  }`}
                >
                  {isGeneratingCharacters ? '生成中...' : '生成人物设定'}
                </button>
	                <p className="text-xs text-secondary-600">
	                  将根据世界观生成20-30个完整人物群像
                </p>
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
	                  不按主角团、阵营或反派模板分类
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <BookOpen className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">情节细纲生成</h2>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-secondary-200 bg-secondary-50 p-4">
                  <div className="text-sm font-medium text-secondary-900 mb-3">生成模式</div>
                  <div className="flex flex-wrap gap-3">
	                    <button
	                      onClick={() => setOutlineMode('novel')}
	                      disabled={!canUseAIGeneration}
	                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
	                        outlineMode === 'novel'
	                          ? 'bg-primary-600 text-white shadow-sm'
	                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                      } disabled:opacity-50 disabled:cursor-not-allowed`}
	                    >
                      网文情节细纲
                    </button>
	                    <button
	                      onClick={() => setOutlineMode('microdrama')}
	                      disabled={!canUseAIGeneration}
	                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
	                        outlineMode === 'microdrama'
	                          ? 'bg-primary-600 text-white shadow-sm'
	                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                      } disabled:opacity-50 disabled:cursor-not-allowed`}
	                    >
	                      微短剧大纲
	                    </button>
	                    <button
	                      onClick={() => setOutlineMode('literature')}
	                      disabled={!canUseAIGeneration}
	                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
	                        outlineMode === 'literature'
	                          ? 'bg-primary-600 text-white shadow-sm'
	                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                      } disabled:opacity-50 disabled:cursor-not-allowed`}
	                    >
	                      文学作品细纲
	                    </button>
	                  </div>
                  {outlineMode === 'microdrama' && (
                    <div className="mt-4 space-y-4">
                      <div className="text-xs font-medium text-secondary-700 mb-2">集数规格</div>
                      <div className="grid grid-cols-4 gap-2">
                        {([15, 30, 60, 100] as const).map((count) => (
	                          <button
	                            key={count}
	                            onClick={() => setMicrodramaEpisodeCount(count)}
	                            disabled={!canUseAIGeneration}
	                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
	                              microdramaEpisodeCount === count
	                                ? 'bg-primary-100 text-primary-700 border border-primary-300'
	                                : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
	                            } disabled:opacity-50 disabled:cursor-not-allowed`}
	                          >
                            {count}集
                          </button>
                        ))}
                      </div>
	                      <button
	                        type="button"
	                        onClick={() => setReduceSensitiveContent(prev => !prev)}
	                        disabled={!canUseAIGeneration}
	                        className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
	                          reduceSensitiveContent
	                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
	                            : 'border-secondary-200 bg-white text-secondary-700 hover:border-emerald-300'
	                        } disabled:opacity-50 disabled:cursor-not-allowed`}
	                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">降低审核风险</div>
                            <div className="mt-1 text-xs opacity-80">
                              弱化血腥、敏感、露骨暴力桥段，用关系压迫、身份错位、限时危机和公开打脸替代。
                            </div>
                          </div>
                          <div className={`h-5 w-10 rounded-full p-0.5 transition-colors ${
                            reduceSensitiveContent ? 'bg-emerald-500' : 'bg-secondary-300'
                          }`}>
                            <div className={`h-4 w-4 rounded-full bg-white transition-transform ${
                              reduceSensitiveContent ? 'translate-x-5' : 'translate-x-0'
                            }`}></div>
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
	                <button
	                  onClick={handleGenerateOutline}
	                  disabled={isGeneratingOutline || !charactersGenerated || !canUseAIGeneration}
	                  className={`w-full py-3 disabled:opacity-50 ${
	                    charactersGenerated && canUseAIGeneration
	                      ? 'btn btn-primary'
	                      : 'btn btn-secondary cursor-not-allowed bg-secondary-300 hover:bg-secondary-300'
                  }`}
                >
                  {isGeneratingOutline ? '生成中...' : outlineModeMeta.buttonText}
                </button>
                <p className="text-xs text-secondary-600">
                  {outlineModeMeta.generateHint}
                </p>
                {outlineMode === 'novel' && (
                  <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-secondary-900">增补下一批中故事</div>
                        <div className="mt-1 text-xs text-secondary-600">
                          当前检测到 {outlineMacroStoryCount} 个中故事，下一批将生成第 {nextSupplementStart}-{nextSupplementEnd} 个。
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSupplementOutlineBatch}
                        disabled={
                          isSupplementingOutline ||
                          isGeneratingOutline ||
                          outlineMacroStoryCount <= 0 ||
                          !charactersGenerated ||
                          !canUseAIGeneration
                        }
                        className="btn btn-secondary inline-flex items-center justify-center gap-2 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FilePlus2 className="h-4 w-4" />
                        {isSupplementingOutline
                          ? '增补中...'
                          : supplementOutlineAsFinal
                            ? '增补大结局10个中故事'
                            : '增补10个中故事'}
                      </button>
                    </div>
                    <label className="flex items-start gap-2 text-xs text-secondary-700">
                      <input
                        type="checkbox"
                        checked={supplementOutlineAsFinal}
                        onChange={(event) => setSupplementOutlineAsFinal(event.target.checked)}
                        disabled={isSupplementingOutline || !canUseAIGeneration}
                        className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                      />
                      <span>
                        本次作为大结局批次。未勾选时，AI 必须承接上一个中故事结尾继续推进，但不能进入终局收束。
                      </span>
                    </label>
                  </div>
                )}
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  自动优化情节连贯性
                </div>
              </div>
            </div>

            {canUseAIGeneration && bookName.trim() && (
              <div className="card p-6 bg-gradient-to-r from-purple-50 to-primary-50 border-2 border-purple-200">
                <div className="text-center">
                  <div className="inline-flex items-center space-x-3 mb-4">
                    <div className="p-3 bg-purple-100 rounded-full">
                      <Sparkles className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-secondary-900">一键生成完整设定</h2>
                      <p className="text-sm text-secondary-600">自动生成世界观+人物+情节</p>
                    </div>
                  </div>

                  <button
                    onClick={handleBatchGenerate}
                    disabled={batchGenerating || !canUseAIGeneration}
                    className="w-full bg-gradient-to-r from-purple-600 to-primary-600 hover:from-purple-700 hover:to-primary-700 text-white py-4 px-6 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
                  >
                    {batchGenerating ? (
                      <div className="flex items-center justify-center space-x-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        <span>生成中...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center space-x-3">
                        <Wand2 className="w-6 h-6" />
                        <span>一键生成全部设定</span>
                        <Sparkles className="w-5 h-5" />
                      </div>
                    )}
                  </button>

                  {batchGenerationProgress && (
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2 mb-2">
                        <span className="text-sm font-medium text-secondary-700">
                          {batchGenerationProgress.current}/{batchGenerationProgress.total}
                        </span>
                        <span className="text-sm text-secondary-600">
                          {batchGenerationProgress.message}
                        </span>
                      </div>
                      <div className="w-full bg-secondary-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-purple-600 to-primary-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${(batchGenerationProgress.current / batchGenerationProgress.total) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-secondary-500 mt-4">
                    AI将按顺序生成完整的世界观体系、人物设定和情节框架
                  </div>
                </div>
              </div>
            )}

            {/* 前往界面三的按钮 */}
            {outline && (
              <button
                onClick={handleNavigateToStructure}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white py-4 px-6 rounded-xl flex items-center justify-center space-x-3 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold text-lg"
              >
                <div className="p-2 bg-white/20 rounded-lg">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="font-bold">前往情节结构细化</div>
                  <div className="text-sm opacity-90">为每个中故事选择微故事卡</div>
                </div>
              </button>
            )}
          </div>

          {/* 右侧内容区域 */}
          <div className="lg:col-span-8">
            {/* 标签页切换 */}
            <div className="mb-6">
              <div className="flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-lg p-1 border border-secondary-200">
                  <button
                    onClick={() => setActiveTab('world')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'world'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <MapIcon className="w-4 h-4" />
                    <span>世界观基础</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('characters')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'characters'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>人物设定</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('outline')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'outline'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>{outlineModeMeta.shortName}</span>
                  </button>
              </div>
            </div>

            {/* 内容显示区域 */}
            <div className="min-h-[600px]">
              {/* 世界观基础设定标签页 */}
              {activeTab === 'world' && (
                <div className="card p-6 h-full">
                  {worldSetting || editingSection === 'world' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <MapIcon className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">世界观基础设定结果</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'world' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'world' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('world')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('world')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'world' && (
                        <div className="mb-5 border border-primary-100 bg-primary-50/70 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-primary-900">按批注补充世界观</div>
                              <div className="text-xs text-primary-700 mt-1">AI会基于当前正文补充内容，并插入到合适位置。</div>
                            </div>
	                            <button
	                              onClick={handleSupplementWorldSetting}
	                              disabled={isSupplementingWorldSetting || !supplementNotes.world.trim() || !canUseAIGeneration}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                            >
                              {isSupplementingWorldSetting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              补充生成
                            </button>
                          </div>
                          <textarea
                            value={supplementNotes.world}
                            onChange={(e) => setSupplementNotes(prev => ({ ...prev, world: e.target.value }))}
                            className="w-full min-h-[84px] p-3 border border-primary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-secondary-800 bg-white"
                            placeholder="写批注：比如补充货币体系、某个宗门的历史、特殊能力代价、城市地下势力规则..."
                          />
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'world' ? (
                          <textarea
                            value={sectionDrafts.world}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, world: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder="可在这里手动修改世界观基础设定"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(worldSetting)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <MapIcon className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        尚未生成世界观基础设定
                      </h3>
	                      <p className="text-secondary-600 mb-4">
	                        {canUseAIGeneration ? '你可以点击下方按钮手动填写，或先走AI生成流程' : '当前未引用灵感架构，只能手动填写'}
	                      </p>
                      <button
                        onClick={() => startEditSection('world')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>手动填写世界观基础</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 人物设定标签页 */}
              {activeTab === 'characters' && (
                <div className="card p-6 h-full">
                  {characters || editingSection === 'characters' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <Users className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">人物设定结果</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'characters' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'characters' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('characters')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('characters')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'characters' && (
                        <div className="mb-5 border border-primary-100 bg-primary-50/70 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-primary-900">按批注补充人物设定</div>
                              <div className="text-xs text-primary-700 mt-1">AI会基于当前人设补充角色、关系或状态，并插入到合适位置。</div>
                            </div>
	                            <button
	                              onClick={handleSupplementCharacters}
	                              disabled={isSupplementingCharacters || !supplementNotes.characters.trim() || !canUseAIGeneration}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                            >
                              {isSupplementingCharacters ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              补充生成
                            </button>
                          </div>
                          <textarea
                            value={supplementNotes.characters}
                            onChange={(e) => setSupplementNotes(prev => ({ ...prev, characters: e.target.value }))}
                            className="w-full min-h-[84px] p-3 border border-primary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-secondary-800 bg-white"
	                            placeholder="写批注：比如补充某个家庭/单位/行业圈层的人物、增加旧案相关人、强化人物之间的亏欠与秘密、给边缘角色加隐藏动机..."
                          />
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'characters' ? (
                          <textarea
                            value={sectionDrafts.characters}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, characters: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder="可在这里手动修改人物设定"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(characters)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <Users className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        尚未生成人物设定
                      </h3>
	                      <p className="text-secondary-600 mb-4">
	                        {canUseAIGeneration ? '你可以点击下方按钮手动填写，或先走AI生成流程' : '当前未引用灵感架构，只能手动填写'}
	                      </p>
                      <button
                        onClick={() => startEditSection('characters')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>手动填写人物设定</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 情节细纲标签页 */}
              {activeTab === 'outline' && (
                <div className="card p-6 h-full">
                  {outline || editingSection === 'outline' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <FileText className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">{outlineModeMeta.resultTitle}</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'outline' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'outline' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('outline')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('outline')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'outline' && (
                        <div className="mb-5 border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-amber-900">导入建议后重生成中故事</div>
                              <div className="text-xs text-amber-700 mt-1">
                                会抓住当前情节细纲，结合世界观和人物设定，按建议完整重写所有中故事。
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-sm font-medium cursor-pointer">
                                <Download className="w-4 h-4" />
                                导入建议
                                <input
                                  type="file"
                                  accept=".txt,.md,.json,text/plain,text/markdown,application/json"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    handleImportOutlineSuggestion(file);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
	                              <button
	                                onClick={handleRegenerateOutlineWithSuggestion}
	                                disabled={isRegeneratingOutlineWithSuggestion || !outlineRevisionSuggestion.trim() || !canUseAIGeneration}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                              >
                                {isRegeneratingOutlineWithSuggestion ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                按建议重生成
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={outlineRevisionSuggestion}
                            onChange={(e) => setOutlineRevisionSuggestion(e.target.value)}
                            className="w-full min-h-[96px] p-3 border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm text-secondary-800 bg-white"
                            placeholder="粘贴修改建议，或导入txt/md文件。比如：减少副线、强化男主事业线、保留爱情线但降低血腥桥段、第3个中故事改成更强反转..."
                          />
                          {outlineStoryContents.length > 0 && (
                            <div className="rounded-lg border border-indigo-200 bg-white p-4 space-y-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-indigo-900">选中中故事局部细化</div>
                                  <div className="text-xs text-indigo-700 mt-1">
                                    可选1-5个中故事，只替换选中段落；适合像滑块迭代一样单独加强某几个中故事。
                                  </div>
                                </div>
                                <button
                                  onClick={handleRefineSelectedOutlineStories}
                                  disabled={isRefiningSelectedOutlineStories || selectedOutlineStoryIndexes.length === 0 || !canUseAIGeneration}
                                  className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                                >
                                  {isRefiningSelectedOutlineStories ? <RefreshCw className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                                  局部细化选中项
                                </button>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 max-h-40 overflow-y-auto pr-1">
                                {outlineStoryContents.map((storyContent, index) => {
                                  const isSelected = selectedOutlineStoryIndexes.includes(index);
                                  return (
                                    <button
                                      key={index}
                                      type="button"
                                      onClick={() => toggleSelectedOutlineStory(index)}
                                      className={`text-left rounded-lg border p-2 transition-all ${
                                        isSelected
                                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-100'
                                          : 'border-secondary-200 bg-secondary-50 text-secondary-700 hover:border-indigo-300'
                                      }`}
                                    >
                                      <div className="text-xs font-semibold">中故事 {index + 1}</div>
                                      <div className="mt-1 text-[11px] leading-snug line-clamp-2 opacity-80">
                                        {storyContent.slice(0, 56)}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                              <textarea
                                value={selectedOutlineRefineNote}
                                onChange={(e) => setSelectedOutlineRefineNote(e.target.value)}
                                className="w-full min-h-[72px] p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-secondary-800 bg-white"
                                placeholder="可写局部细化要求：比如只强化第7-8中故事的反派压迫、补足女主主动性、让结尾对齐下一个中故事开局。留空则按三密度自动强化。"
                              />
                              {selectedOutlineStoryIndexes.length > 0 && (
                                <div className="text-xs text-indigo-700">
                                  已选：{selectedOutlineStoryIndexes.map(index => index + 1).join('、')}，本次会只替换这些中故事。
                                </div>
                              )}
                            </div>
                          )}
                          {renderDensityTuningPanel()}
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'outline' ? (
                          <textarea
                            value={sectionDrafts.outline}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, outline: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder={`可在这里手动修改${outlineModeMeta.shortName}`}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(outline)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <FileText className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        {outlineModeMeta.emptyTitle}
                      </h3>
	                      <p className="text-secondary-600 mb-4">
	                        {canUseAIGeneration ? '你可以点击下方按钮手动填写，或先走AI生成流程' : '当前未引用灵感架构，只能手动填写'}
	                      </p>
                      <button
                        onClick={() => startEditSection('outline')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>{outlineModeMeta.emptyActionText}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 默认状态 */}
              {!characters && !outline && (
                <div className="card p-8 text-center">
                  <Sparkles className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-secondary-900 mb-2">
                    世界观与人物体系构建
                  </h3>
                  <p className="text-secondary-600">
                    点击左侧按钮生成人物设定和情节细纲，开始构建完整的故事世界
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 项目管理面板 */}
      {showProjectPanel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
            {/* 面板头部 */}
            <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FolderOpen className="w-6 h-6" />
                  <div>
                    <h2 className="text-xl font-bold">世界设定项目管理</h2>
                    <p className="text-primary-100 text-sm">
                      已保存 {projects.length} 个完整的世界设定项目
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <label
                    className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    title="从导出的JSON文件导入并恢复项目"
                  >
                    <span>导入项目</span>
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        // 允许重复选择同一个文件也触发
                        e.target.value = '';
                        void handleImportProjectFile(file);
                      }}
                    />
                  </label>
                  <button
                    onClick={handlePullCloudProjects}
                    disabled={isPullingCloudProjects}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                    title="按当前激活码从云端拉回项目和正文数据"
                  >
                    <RefreshCw className={`w-4 h-4 ${isPullingCloudProjects ? 'animate-spin' : ''}`} />
                    <span>{isPullingCloudProjects ? '拉取中' : '拉取云端'}</span>
                  </button>
                  {projects.length > 0 && (
                    <button
                      onClick={exportAllProjects}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>导出全部</span>
                    </button>
                  )}
                  {projects.length > 0 && (
                    <button
                      onClick={handleClearNovelCacheForAll}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-red-500/90 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
                      title="清空所有项目的已生成正文/版本历史/Writer进度等缓存（保留设定）"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>清空正文缓存</span>
                    </button>
                  )}
                  <button
                    onClick={() => setShowProjectPanel(false)}
                    className="w-8 h-8 flex items-center justify-center bg-primary-500 hover:bg-primary-400 rounded-lg transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* 项目列表 */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {projects.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-secondary-900 mb-2">
                    还没有保存的世界设定项目
                  </h3>
                  <p className="text-secondary-600">
                    完成世界观基础设定、人物设定和情节细纲的生成后，点击"保存项目"来保存完整设定
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${
                        currentProject?.id === project.id ? 'border-primary-300 bg-primary-50' : 'border-secondary-200'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-secondary-900 mb-1">
                            {project.bookName}
                          </h3>
                          <p className="text-sm text-secondary-600 mb-2">
                            基于架构: {project.outline.title}
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-secondary-500">
                            <span className={`flex items-center space-x-1 ${project.worldSetting ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.worldSetting ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>世界观基础</span>
                            </span>
                            <span className={`flex items-center space-x-1 ${project.characters ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.characters ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>人物设定</span>
                            </span>
                            <span className={`flex items-center space-x-1 ${project.detailedOutline ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.detailedOutline ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>情节细纲</span>
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <button
                            onClick={() => handleLoadProject(project)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700 transition-colors"
                          >
                            <FileText className="w-4 h-4" />
                            <span>加载</span>
                          </button>
                          <button
                            onClick={() => exportProject(project)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm hover:bg-secondary-200 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            <span>导出</span>
                          </button>
                          <button
                            onClick={() => handleClearNovelCacheForOne(project.id, project.bookName)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 transition-colors"
                            title="仅清空该项目已生成正文/版本历史/Writer进度（保留设定）"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>清正文</span>
                          </button>
                          <button
                            onClick={() => handleDeleteProject(project.id)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-secondary-500">
                        <div className="flex items-center space-x-1">
                          <span>创建时间: {new Date(project.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                        <span>项目 #{project.id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
