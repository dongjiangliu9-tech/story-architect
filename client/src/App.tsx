import { useState, useEffect } from 'react';
// import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Sparkles, BookOpen, Wand2, Bookmark, PenTool, FilePlus2, Save, X } from 'lucide-react';
import { NovelCategory, NovelStyle, OutlineData, TitleVariant } from './types';
import { CreativeConfigSelector } from './components/CreativeConfigSelector';
import { GenerateButton } from './components/GenerateButton';
import { OutlineCard } from './components/OutlineCard';
import { OutlineNavigator } from './components/OutlineNavigator';
import { LoadingSpinner } from './components/LoadingSpinner';
import { SavedOutlinesPanel } from './components/SavedOutlinesPanel';
import { AutoGenerationProgress } from './components/AutoGenerationProgress';
import { WorldSettingPage } from './pages/WorldSettingPage';
import { WriterPage } from './pages/WriterPage';
import { SavedOutlinesProvider, useSavedOutlines } from './contexts/SavedOutlinesContext';
import { WorldSettingsProvider } from './contexts/WorldSettingsContext';
import { StoryStructurePage } from './pages/StoryStructurePage';
import { blueprintApi } from './services/api';
import { parseOutlineContent } from './utils/outlineParser';
import { useAutoGeneration, type AutoGenerationDestination, type AutoGenerationPauseMode } from './hooks/useAutoGeneration';
import {
  DEFAULT_LOGIC_MODEL_VALUE,
  LOGIC_MODEL_OPTIONS,
  OFFICIAL_LOGIC_MODEL_VALUE,
  getPreferredLogicModelValue,
  toLogicModelRequest,
  toPreferredLogicModelFields,
} from './utils/llmModelSelection';

const LOGIC_MODEL_STORAGE_KEY = 'story-architect-logic-model';
const LOGIC_MODEL_DEFAULT_MIGRATION_KEY = 'story-architect-logic-model-default-migrated';
const BLUEPRINT_OUTLINES_STORAGE_KEY = 'story-architect-blueprint-outlines';
const BLUEPRINT_OUTLINE_INDEX_STORAGE_KEY = 'story-architect-blueprint-current-index';

function getOutlineBookName(outline?: OutlineData | null): string {
  return (outline?.aliasTitle || outline?.title || '').trim();
}

function formatOutlineForTitleVariants(outline: OutlineData): string {
  return `### ${outline.title}
${outline.aliasTitle ? `又名：${outline.aliasTitle}\n` : ''}${outline.aliasSynopsis ? `简介：${outline.aliasSynopsis}\n` : ''}${outline.aliasTags?.length ? `标签：${outline.aliasTags.join('、')}\n` : ''}
核心概念：
${outline.logline}

人物关系：
${outline.characters}

世界观设定：
${outline.world}

主要冲突：
${outline.hook}

金手指设定：
${outline.themes}`;
}

function BlueprintPage({
  onNavigate
}: {
  onNavigate: (page: string, outline?: OutlineData, shouldNavigateToStructure?: boolean) => void;
}) {
  const { updateSavedOutlineIfExists } = useSavedOutlines();
  const [selectedCategory, setSelectedCategory] = useState<NovelCategory | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<NovelStyle[]>([]);
  const [theme, setTheme] = useState('');
  const [bookName, setBookName] = useState('');
  const [autoGenerationTarget, setAutoGenerationTarget] = useState<'microdrama-15' | 'microdrama-30' | 'novel-75'>('microdrama-15');
  const [isAutoSetupOpen, setIsAutoSetupOpen] = useState(false);
  const [autoPauseMode, setAutoPauseMode] = useState<AutoGenerationPauseMode>('density');
  const [autoClearExisting, setAutoClearExisting] = useState(true);
  const [autoWorldviewMode, setAutoWorldviewMode] = useState<'web' | 'realistic'>('web');
  const [autoNeedsUpgradeSystem, setAutoNeedsUpgradeSystem] = useState(true);
  const [autoRealisticWorldviewContext, setAutoRealisticWorldviewContext] = useState('');
  const [logicModelValue, setLogicModelValue] = useState(() => {
    try {
      const savedValue = localStorage.getItem(LOGIC_MODEL_STORAGE_KEY);
      const migrated = localStorage.getItem(LOGIC_MODEL_DEFAULT_MIGRATION_KEY) === 'true';

      if (savedValue === OFFICIAL_LOGIC_MODEL_VALUE && !migrated) {
        localStorage.setItem(LOGIC_MODEL_DEFAULT_MIGRATION_KEY, 'true');
        return DEFAULT_LOGIC_MODEL_VALUE;
      }

      return savedValue || DEFAULT_LOGIC_MODEL_VALUE;
    } catch {
      return DEFAULT_LOGIC_MODEL_VALUE;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [outlines, setOutlines] = useState<OutlineData[]>(() => {
    try {
      const saved = localStorage.getItem(BLUEPRINT_OUTLINES_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [currentOutlineIndex, setCurrentOutlineIndex] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(BLUEPRINT_OUTLINE_INDEX_STORAGE_KEY) || 0);
      return Number.isFinite(saved) && saved >= 0 ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [isSavedPanelOpen, setIsSavedPanelOpen] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState<OutlineData | null>(null);
  const [editingOutlineIndex, setEditingOutlineIndex] = useState<number | null>(null);
  const [lastCommittedOutline, setLastCommittedOutline] = useState<OutlineData | null>(null);
  const [isGeneratingTitleVariants, setIsGeneratingTitleVariants] = useState(false);
  const [titleVariants, setTitleVariants] = useState<TitleVariant[]>([]);
  const [selectedTitleVariantIndex, setSelectedTitleVariantIndex] = useState(0);
  const [selectedSynopsisVariantIndex, setSelectedSynopsisVariantIndex] = useState(0);
  const [titleVariantError, setTitleVariantError] = useState<string | null>(null);
  const isEditingOutline = outlineDraft !== null;
  const resolvedOutlineIndex =
    currentOutlineIndex >= 0 && currentOutlineIndex < outlines.length
      ? currentOutlineIndex
      : 0;
  const currentOutline = outlines[resolvedOutlineIndex] ?? null;
  const isLiteraryWorkSelected = selectedCategory?.id === 'literature' || selectedCategory?.name === '文学作品';
  const finalOutlineSectionTitle = isLiteraryWorkSelected ? '文学核心' : '金手指设定';
  const finalOutlineSectionPlaceholder = isLiteraryWorkSelected
    ? '作品气质、叙事特色、主题余韵、人物精神困境'
    : '外挂、能力成长路径、资源机制';

  const createCachedOutline = (outline: OutlineData): OutlineData => ({
    id: outline.id,
    title: (outline.title || '').slice(0, 200),
    aliasTitle: (outline.aliasTitle || '').slice(0, 200),
    aliasSynopsis: (outline.aliasSynopsis || '').slice(0, 1000),
    aliasTags: outline.aliasTags || [],
    logline: (outline.logline || '').slice(0, 2000),
    hook: (outline.hook || '').slice(0, 2000),
    characters: (outline.characters || '').slice(0, 2000),
    world: (outline.world || '').slice(0, 2000),
    themes: (outline.themes || '').slice(0, 2000),
    rawContent: '',
    preferredLlmModelProvider: outline.preferredLlmModelProvider,
    preferredLlmModel: outline.preferredLlmModel,
  });

  const persistBlueprintOutlines = (nextOutlines: OutlineData[], nextIndex = currentOutlineIndex) => {
    try {
      const compactOutlines = nextOutlines.map(createCachedOutline);
      localStorage.setItem(BLUEPRINT_OUTLINES_STORAGE_KEY, JSON.stringify(compactOutlines));
      localStorage.setItem(BLUEPRINT_OUTLINE_INDEX_STORAGE_KEY, String(nextIndex));
    } catch (error) {
      console.warn('缓存灵感架构列表失败:', error);
    }
  };

  const createBlankOutline = (): OutlineData => ({
    id: Date.now(),
    title: '',
    logline: '',
    hook: '',
    characters: '',
    world: '',
    themes: '',
    rawContent: '',
    ...toPreferredLogicModelFields(logicModelValue),
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOGIC_MODEL_STORAGE_KEY, logicModelValue);
      localStorage.setItem(LOGIC_MODEL_DEFAULT_MIGRATION_KEY, 'true');
    } catch {
      // Ignore localStorage failures so model selection never blocks generation.
    }
  }, [logicModelValue]);

  useEffect(() => {
    persistBlueprintOutlines(outlines, resolvedOutlineIndex);
  }, [outlines, resolvedOutlineIndex]);

  useEffect(() => {
    if (autoGenerationTarget === 'microdrama-15' || autoGenerationTarget === 'microdrama-30') {
      setAutoPauseMode('density');
    } else {
      setAutoPauseMode('none');
    }
  }, [autoGenerationTarget]);

  const confirmDiscardOutlineEdits = () => {
    if (!isEditingOutline) return true;
    return confirm('你有未保存的灵感架构修改，确定要丢弃吗？');
  };

  // 一键生成功能
  const {
    isAutoGenerating,
    steps,
    currentStepMessage,
    startAutoGeneration,
    cancelAutoGeneration
  } = useAutoGeneration();

  const handleGenerate = async () => {
    if (!selectedCategory || selectedStyles.length === 0 || !theme.trim()) {
      setError('请先选择频道、风格并填写核心主题');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // 清除之前保存的selectedOutline，避免混淆
      localStorage.removeItem('story-architect-current-outline');

      const response = await blueprintApi.generateOutline({
        channel: `${selectedCategory.name}`,
        style: selectedStyles.map(s => s.name).join('、'),
        theme: theme.trim(),
        ...toLogicModelRequest(logicModelValue),
      });

      // 解析AI返回的Markdown内容
      const parsedOutlines = parseOutlineContent(response.data).map(outline => ({
        ...outline,
        ...toPreferredLogicModelFields(logicModelValue),
      }));

      if (parsedOutlines.length === 0) {
        throw new Error('未能解析到有效的大纲内容');
      }

      setOutlines(parsedOutlines);
      setCurrentOutlineIndex(0);
      persistBlueprintOutlines(parsedOutlines, 0);
      setOutlineDraft(null);
      setEditingOutlineIndex(null);
      setTitleVariants([]);
      setTitleVariantError(null);
    } catch (err) {
      console.error('生成失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };



  const handleNextOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setTitleVariants([]);
    setTitleVariantError(null);
    setCurrentOutlineIndex((prev) => (prev + 1) % outlines.length);
  };

  const handlePrevOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setTitleVariants([]);
    setTitleVariantError(null);
    setCurrentOutlineIndex((prev) => (prev - 1 + outlines.length) % outlines.length);
  };

  const handleLoadSavedOutline = (outline: OutlineData) => {
    if (!confirmDiscardOutlineEdits()) return;
    // 将保存的大纲设置为当前显示的架构
    setOutlines([outline]);
    setCurrentOutlineIndex(0);
    persistBlueprintOutlines([outline], 0);
    setLastCommittedOutline(outline);
    setLogicModelValue(getPreferredLogicModelValue(outline));
    setOutlineDraft(null);
    setEditingOutlineIndex(null);
    setTitleVariants([]);
    setTitleVariantError(null);
  };

  const startEditCurrentOutline = () => {
    const current = currentOutline;
    if (!current) return;
    setEditingOutlineIndex(resolvedOutlineIndex);
    setOutlineDraft({ ...current });
    setTitleVariants([]);
    setTitleVariantError(null);
  };

  const startCreateBlankOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setEditingOutlineIndex(null);
    setOutlineDraft(createBlankOutline());
    setTitleVariants([]);
    setTitleVariantError(null);
  };

  const cancelOutlineEdit = () => {
    setOutlineDraft(null);
    setEditingOutlineIndex(null);
  };

  const commitOutlineDraft = (): OutlineData | null => {
    if (!outlineDraft) return null;
    if (!outlineDraft.title.trim()) {
      setError('请至少填写一个灵感架构标题');
      return null;
    }

    setError(null);
    const normalizedOutline: OutlineData = {
      ...outlineDraft,
      id: outlineDraft.id || Date.now(),
      title: outlineDraft.title.trim(),
      ...toPreferredLogicModelFields(logicModelValue),
    };

    if (editingOutlineIndex === null) {
      setLastCommittedOutline(normalizedOutline);
      setOutlines(prev => {
        const next = [...prev, normalizedOutline];
        setCurrentOutlineIndex(next.length - 1);
        persistBlueprintOutlines(next, next.length - 1);
        return next;
      });
    } else {
      setLastCommittedOutline(normalizedOutline);
      setOutlines(prev => {
        const next = prev.map((item, index) => (index === editingOutlineIndex ? normalizedOutline : item));
        persistBlueprintOutlines(next, editingOutlineIndex);
        return next;
      });
      setCurrentOutlineIndex(editingOutlineIndex);
    }

    try {
      localStorage.setItem('story-architect-current-outline', JSON.stringify(createCachedOutline(normalizedOutline)));
    } catch (error) {
      console.warn('缓存当前灵感架构失败，继续使用内存态跳转:', error);
    }

    setOutlineDraft(null);
    setEditingOutlineIndex(null);
    return normalizedOutline;
  };

  const saveOutlineEdit = () => {
    commitOutlineDraft();
  };

  const saveOutlineAndEnterWorldSetting = () => {
    const committedOutline = commitOutlineDraft();
    if (!committedOutline) return;
    onNavigate('world-setting', committedOutline);
  };

  const updateOutlineDraft = (field: keyof OutlineData, value: string) => {
    setOutlineDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const updateOutlineDraftTags = (value: string) => {
    setOutlineDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        aliasTags: value.split(/[、,，/|｜\s]+/).map(tag => tag.trim()).filter(Boolean),
      };
    });
  };

  const handleGenerateTitleVariants = async () => {
    const outline = currentOutline;
    if (!outline) {
      setTitleVariantError('请先生成或选择一个灵感架构');
      return;
    }

    setIsGeneratingTitleVariants(true);
    setTitleVariantError(null);

    try {
      const response = await blueprintApi.generateTitleVariants({
        outline: formatOutlineForTitleVariants(outline),
        ...toLogicModelRequest(logicModelValue),
      });

      if (!response.data?.length) {
        throw new Error('没有解析到有效的书名简介候选');
      }

      setTitleVariants(response.data);
      setSelectedTitleVariantIndex(0);
      setSelectedSynopsisVariantIndex(0);
    } catch (err) {
      console.error('生成书名简介候选失败:', err);
      setTitleVariantError(err instanceof Error ? err.message : '生成书名简介候选失败，请稍后重试');
    } finally {
      setIsGeneratingTitleVariants(false);
    }
  };

  const applySelectedTitleVariant = () => {
    const outline = currentOutline;
    const titleVariant = titleVariants[selectedTitleVariantIndex];
    const synopsisVariant = titleVariants[selectedSynopsisVariantIndex];
    if (!outline || !titleVariant || !synopsisVariant) return;

    const updatedOutline: OutlineData = {
      ...outline,
      aliasTitle: titleVariant.title.trim(),
      aliasSynopsis: synopsisVariant.synopsis.trim(),
      aliasTags: synopsisVariant.tags || [],
      ...toPreferredLogicModelFields(logicModelValue),
    };

    setOutlines(prev => {
      const next = prev.map((item, index) => (index === resolvedOutlineIndex ? updatedOutline : item));
      persistBlueprintOutlines(next, resolvedOutlineIndex);
      return next;
    });
    updateSavedOutlineIfExists(outline, updatedOutline);
    setLastCommittedOutline(updatedOutline);
    setBookName(updatedOutline.aliasTitle || updatedOutline.title);
    try {
      localStorage.setItem('story-architect-current-outline', JSON.stringify(createCachedOutline(updatedOutline)));
    } catch (error) {
      console.warn('缓存改名后的灵感架构失败:', error);
    }
  };

  const handleEnterWorldSetting = () => {
    if (outlineDraft) {
      const draftOutline: OutlineData = {
        ...outlineDraft,
        id: outlineDraft.id || Date.now(),
        title: outlineDraft.title.trim() || '未命名灵感架构',
        ...toPreferredLogicModelFields(logicModelValue),
      };
      onNavigate('world-setting', draftOutline);
      return;
    }

    const latestOutline =
      currentOutline ||
      outlines[resolvedOutlineIndex] ||
      lastCommittedOutline ||
      null;

    const latestSavedOutline = (() => {
      try {
        const raw = localStorage.getItem('story-architect-current-outline');
        return raw ? JSON.parse(raw) as OutlineData : null;
      } catch {
        return null;
      }
    })();

    const finalOutline = latestOutline || latestSavedOutline || {
      ...createBlankOutline(),
      title: bookName.trim() || '未命名灵感架构',
    };

    setError(null);
    onNavigate('world-setting', {
      ...finalOutline,
      ...toPreferredLogicModelFields(logicModelValue),
    });
  };

  const readCachedOutline = (): OutlineData | null => {
    try {
      const raw = localStorage.getItem('story-architect-current-outline');
      return raw ? JSON.parse(raw) as OutlineData : null;
    } catch {
      return null;
    }
  };

  const resolveOutlineForAutoGeneration = (): OutlineData | null => {
    const source =
      outlineDraft ||
      currentOutline ||
      outlines[resolvedOutlineIndex] ||
      lastCommittedOutline ||
      readCachedOutline();

    if (!source) return null;

    const resolvedTitle = source.title?.trim() || bookName.trim() || '未命名灵感架构';
    return {
      ...source,
      id: source.id || Date.now(),
      title: resolvedTitle,
      ...toPreferredLogicModelFields(logicModelValue),
    };
  };

  const getValidatedAutoOutline = () => {
    const outline = resolveOutlineForAutoGeneration();
    const hasOutlineContent = outline && [
      outline.title,
      outline.logline,
      outline.characters,
      outline.world,
      outline.hook,
      outline.themes,
    ].some(value => String(value || '').trim().length > 0);

    if (!outline || !hasOutlineContent) {
      setError('请先选择、生成或填写一个灵感架构');
      return null;
    }

    return outline;
  };

  const handleOpenAutoGenerationSetup = () => {
    const outline = getValidatedAutoOutline();
    if (!outline) return;
    setError(null);
    setIsAutoSetupOpen(true);
  };

  const handleStartAutoLiteraryIteration = () => {
    const outline = getValidatedAutoOutline();
    if (!outline) return;
    if (autoWorldviewMode === 'realistic' && !autoRealisticWorldviewContext.trim()) {
      setError('请先填写现实主义背景，例如“上世纪80年代东北县城”或“1990年代广州服装批发市场”。');
      return;
    }

    const resolvedBookName = bookName.trim() || getOutlineBookName(outline) || '未命名作品';
    setError(null);
    setIsAutoSetupOpen(false);

    try {
      localStorage.setItem('story-architect-current-outline', JSON.stringify(createCachedOutline(outline)));
    } catch (error) {
      console.warn('缓存当前灵感架构失败，继续启动自动流程:', error);
    }

    startAutoGeneration(
      outline,
      resolvedBookName,
      (_projectId, destination: AutoGenerationDestination = 'writer') => {
        onNavigate(destination, outline, destination === 'story-structure');
      },
      (message) => setError(message),
      {
        target: autoGenerationTarget,
        pauseAfter: autoPauseMode,
        clearExisting: autoClearExisting,
        useRealisticWorldview: autoWorldviewMode === 'realistic',
        realisticWorldviewContext: autoWorldviewMode === 'realistic' ? autoRealisticWorldviewContext.trim() : undefined,
        needsUpgradeSystem: autoWorldviewMode === 'realistic' ? false : autoNeedsUpgradeSystem,
      }
    );
  };

  const hasOutlineForAutoGeneration = Boolean(
    outlineDraft ||
    currentOutline ||
    lastCommittedOutline ||
    readCachedOutline()
  );


  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <BookOpen className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-secondary-900">故事架构师</h1>
                <p className="text-sm text-secondary-600">AI 驱动的网文创作助手</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsSavedPanelOpen(true)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-secondary-100 hover:bg-secondary-200 rounded-lg text-secondary-700 text-sm font-medium transition-colors"
              >
                <Bookmark className="w-4 h-4" />
                <span>我的灵感</span>
              </button>
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
            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <Wand2 className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">创作配置</h2>
              </div>

              <div className="space-y-6">
                <CreativeConfigSelector
                  selectedCategory={selectedCategory}
                  selectedStyles={selectedStyles}
                  onSelectCategory={setSelectedCategory}
                  onChangeSelectedStyles={setSelectedStyles}
                />

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-secondary-700">
                    核心主题
                  </label>
                  <textarea
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="可以选择或组合这些核心主题：成长崛起、雪耻复仇、逆袭打脸、身份反转、强者归来、废柴觉醒、权力争夺、财富逆袭、爱情救赎、破镜重圆、婚恋博弈、家族恩怨、生死逃亡、末世求生、守护牺牲。也可以写自定义创意方向。"
                    className="w-full min-h-[96px] px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  />
                  <p className="text-xs text-secondary-500">
                    会和频道、主题/角色/情节标签一起发送给 AI
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-secondary-700">
                    生成模型
                  </label>
                  <select
                    value={logicModelValue}
                    onChange={(e) => setLogicModelValue(e.target.value)}
                    className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                  >
                    {LOGIC_MODEL_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.description}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-secondary-500">
                    选择网关模型后，灵感架构到情节细化阶段会沿用该模型，额度仍计入 Gemini。
                  </p>
                </div>

                {/* 书名输入 - 用于一键生成 */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-secondary-700">
                    书名
                  </label>
                  <input
                    type="text"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    placeholder="请输入小说书名"
                    className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-secondary-500">
                    一键生成时会以此书名创建项目并缓存数据
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}

                <GenerateButton
                  onClick={handleGenerate}
                  disabled={!selectedCategory || selectedStyles.length === 0 || !theme.trim() || isGenerating}
                  isLoading={isGenerating}
                />

                {/* 跳转到World Setting按钮 */}
                <button
                  onClick={handleEnterWorldSetting}
                  className="w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white flex items-center justify-center space-x-3"
                >
                  <BookOpen className="w-6 h-6" />
                  <span>进入人设与世界观</span>
                </button>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-secondary-700">
                    自动迭代目标
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'microdrama-15' as const, label: '15集微短剧' },
                      { value: 'microdrama-30' as const, label: '30集微短剧' },
                      { value: 'novel-75' as const, label: '75章网文' },
                    ]).map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAutoGenerationTarget(option.value)}
                        disabled={isAutoGenerating}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          autoGenerationTarget === option.value
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-white border-secondary-200 text-secondary-700 hover:bg-secondary-50'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleOpenAutoGenerationSetup}
                  disabled={!hasOutlineForAutoGeneration || isGenerating || isAutoGenerating}
                  className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg flex items-center justify-center space-x-3 ${
                    !hasOutlineForAutoGeneration || isGenerating || isAutoGenerating
                      ? 'bg-secondary-200 text-secondary-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white hover:shadow-xl transform hover:scale-105'
                  }`}
                >
                  <Sparkles className="w-6 h-6" />
                  <span>{isAutoGenerating ? 'AI自动迭代中...' : `AI自动迭代文学作品（${autoGenerationTarget === 'microdrama-15' ? '15集' : autoGenerationTarget === 'microdrama-30' ? '30集' : '75章'}）`}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 右侧大纲展示区域 */}
          <div className="lg:col-span-8">
            {isGenerating ? (
              <div className="card p-8 text-center">
                <LoadingSpinner />
                <p className="text-secondary-600 mt-4">正在生成精彩的故事架构...</p>
              </div>
            ) : outlines.length > 0 || isEditingOutline ? (
              <div className="space-y-6">
                {outlines.length > 0 && (
                  <OutlineNavigator
                    currentIndex={currentOutlineIndex}
                    total={outlines.length}
                    onPrev={handlePrevOutline}
                    onNext={handleNextOutline}
                  />
                )}
                <div className="card p-4 bg-white/90 border border-secondary-200">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-secondary-600">
                      支持手动维护灵感架构：可编辑当前结果，也可新增空白架构自行填写
                    </div>
                    <div className="flex items-center gap-2">
                      {!isEditingOutline ? (
                        <>
                          {outlines.length > 0 && (
                            <>
                              <button
                                onClick={handleGenerateTitleVariants}
                                disabled={isGeneratingTitleVariants}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                <Wand2 className="w-4 h-4" />
                                <span>{isGeneratingTitleVariants ? '生成中...' : '改书名简介'}</span>
                              </button>
                              <button
                                onClick={startEditCurrentOutline}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <PenTool className="w-4 h-4" />
                                <span>编辑当前架构</span>
                              </button>
                            </>
                          )}
                          <button
                            onClick={startCreateBlankOutline}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md"
                          >
                            <FilePlus2 className="w-4 h-4" />
                            <span>新增空白架构</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={saveOutlineEdit}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                          >
                            <Save className="w-4 h-4" />
                            <span>保存修改</span>
                          </button>
                          <button
                            onClick={saveOutlineAndEnterWorldSetting}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md"
                          >
                            <BookOpen className="w-4 h-4" />
                            <span>保存并进入</span>
                          </button>
                          <button
                            onClick={cancelOutlineEdit}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                          >
                            <X className="w-4 h-4" />
                            <span>取消</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {!isEditingOutline && (titleVariants.length > 0 || titleVariantError || isGeneratingTitleVariants) && (
                  <div className="card p-4 bg-white/95 border border-amber-200">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-secondary-900">书名与简介候选</h3>
                        <p className="text-xs text-secondary-500 mt-1">
                          可分别选择一个书名和一个简介，应用后会作为“又名/简介”显示，原标题不删除。
                        </p>
                      </div>
                      {titleVariants.length > 0 && (
                        <button
                          type="button"
                          onClick={applySelectedTitleVariant}
                          className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
                        >
                          应用选中
                        </button>
                      )}
                    </div>

                    {titleVariantError && (
                      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {titleVariantError}
                      </div>
                    )}

                    {isGeneratingTitleVariants && (
                      <div className="text-sm text-secondary-600">正在让 AI 重新设计 5 组书名、简介和标签...</div>
                    )}

                    {titleVariants.length > 0 && (
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-medium text-secondary-600 mb-2">选择书名</div>
                          <div className="flex flex-wrap gap-2">
                            {titleVariants.map((variant, index) => (
                              <button
                                key={`title-${index}`}
                                type="button"
                                onClick={() => setSelectedTitleVariantIndex(index)}
                                className={`px-3 py-1.5 rounded-full border text-sm font-medium ${
                                  selectedTitleVariantIndex === index
                                    ? 'bg-amber-600 border-amber-600 text-white'
                                    : 'bg-white border-secondary-200 text-secondary-700 hover:bg-secondary-50'
                                }`}
                              >
                                {variant.title}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {titleVariants.map((variant, index) => (
                            <button
                              key={`synopsis-${index}`}
                              type="button"
                              onClick={() => setSelectedSynopsisVariantIndex(index)}
                              className={`text-left rounded-lg border p-3 transition-colors ${
                                selectedSynopsisVariantIndex === index
                                  ? 'border-amber-500 bg-amber-50'
                                  : 'border-secondary-200 bg-white hover:bg-secondary-50'
                              }`}
                            >
                              <div className="text-sm font-semibold text-secondary-900">{variant.title}</div>
                              <p className="mt-1 text-sm text-secondary-700 leading-relaxed">{variant.synopsis}</p>
                              {variant.tags?.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {variant.tags.map(tag => (
                                    <span key={tag} className="px-2 py-0.5 rounded bg-secondary-100 text-secondary-600 text-xs">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isEditingOutline && outlineDraft ? (
                  <div className="card p-6 animate-fade-in">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-secondary-900">
                        {editingOutlineIndex === null ? '新增空白灵感架构' : '编辑灵感架构'}
                      </h3>
                      <span className="text-xs text-secondary-500">
                        保存后可直接用于后续流程
                      </span>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          标题
                        </label>
                        <input
                          type="text"
                          value={outlineDraft.title}
                          onChange={(e) => updateOutlineDraft('title', e.target.value)}
                          placeholder="请输入灵感架构标题"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          又名
                        </label>
                        <input
                          type="text"
                          value={outlineDraft.aliasTitle || ''}
                          onChange={(e) => updateOutlineDraft('aliasTitle', e.target.value)}
                          placeholder="可填写新的网文书名，原标题会保留"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          简介
                        </label>
                        <textarea
                          value={outlineDraft.aliasSynopsis || ''}
                          onChange={(e) => updateOutlineDraft('aliasSynopsis', e.target.value)}
                          rows={3}
                          placeholder="可填写新的作品简介"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          标签
                        </label>
                        <input
                          type="text"
                          value={(outlineDraft.aliasTags || []).join('、')}
                          onChange={(e) => updateOutlineDraftTags(e.target.value)}
                          placeholder="例如：民俗恐怖、无限流、复仇"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          核心概念
                        </label>
                        <textarea
                          value={outlineDraft.logline}
                          onChange={(e) => updateOutlineDraft('logline', e.target.value)}
                          rows={4}
                          placeholder="故事一句话核心设定"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          人物关系
                        </label>
                        <textarea
                          value={outlineDraft.characters}
                          onChange={(e) => updateOutlineDraft('characters', e.target.value)}
                          rows={4}
                          placeholder="主角、配角、关系网与成长线"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          世界观设定
                        </label>
                        <textarea
                          value={outlineDraft.world}
                          onChange={(e) => updateOutlineDraft('world', e.target.value)}
                          rows={4}
                          placeholder="时代背景、规则体系、势力格局"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          主要冲突
                        </label>
                        <textarea
                          value={outlineDraft.hook}
                          onChange={(e) => updateOutlineDraft('hook', e.target.value)}
                          rows={4}
                          placeholder="主线冲突、关键矛盾与推进动力"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 mb-1">
                          {finalOutlineSectionTitle}
                        </label>
                        <textarea
                          value={outlineDraft.themes}
                          onChange={(e) => updateOutlineDraft('themes', e.target.value)}
                          rows={4}
                          placeholder={finalOutlineSectionPlaceholder}
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                ) : currentOutline ? (
                  <OutlineCard
                    outline={currentOutline}
                    finalSectionTitle={finalOutlineSectionTitle}
                    className="animate-fade-in"
                  />
                ) : null}
              </div>
            ) : (
              <div className="card p-8 text-center">
                <BookOpen className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-secondary-900 mb-2">
                  准备开始创作
                </h3>
                <p className="text-secondary-600">
                  选择频道和风格，输入核心主题，让AI为你生成精彩的故事架构
                </p>
                <div className="mt-6">
                  {!isEditingOutline ? (
                    <button
                      onClick={startCreateBlankOutline}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm"
                    >
                      <FilePlus2 className="w-4 h-4" />
                      <span>新增空白灵感架构</span>
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 保存的大纲面板 */}
      <SavedOutlinesPanel
        isOpen={isSavedPanelOpen}
        onClose={() => setIsSavedPanelOpen(false)}
        onLoadOutline={handleLoadSavedOutline}
      />

      {isAutoSetupOpen && (
        <div className="fixed inset-0 z-[80] bg-secondary-950/50 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-secondary-200 overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-secondary-100">
              <div>
                <h3 className="text-lg font-semibold text-secondary-900">启动 AI 自动迭代</h3>
                <p className="mt-1 text-sm text-secondary-600">
                  第一次使用软件，可以先进入人设与世界观，熟悉完整创作流程。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAutoSetupOpen(false)}
                className="p-2 rounded-lg text-secondary-500 hover:bg-secondary-100 hover:text-secondary-800"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { value: 'microdrama-15' as const, label: '15集微短剧', note: '默认单集约1分钟，节奏轻快' },
                  { value: 'microdrama-30' as const, label: '30集微短剧', note: '单集按约1分钟剧情厚度细化' },
                  { value: 'novel-75' as const, label: '75章网文', note: '5个中故事，每个拆15章' },
                ]).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAutoGenerationTarget(option.value)}
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      autoGenerationTarget === option.value
                        ? 'border-primary-500 bg-primary-50 text-primary-900'
                        : 'border-secondary-200 bg-white text-secondary-800 hover:bg-secondary-50'
                    }`}
                  >
                    <span className="block font-semibold">{option.label}</span>
                    <span className="mt-1 block text-xs text-secondary-500">{option.note}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-secondary-900">题材模式</h4>
                  <p className="mt-1 text-xs text-secondary-500">
                    自动生成世界观时会按这里的模式选择模板，后续人物和中故事会继承这套基础设定。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { value: 'web' as const, label: '网文化模式', note: '适合系统、异能、玄幻、爽点升级和高概念设定' },
                    { value: 'realistic' as const, label: '现实主义模式', note: '适合年代、地域、家庭、职场、社会变迁和现实成长' },
                  ]).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setAutoWorldviewMode(option.value);
                        if (option.value === 'realistic') setAutoNeedsUpgradeSystem(false);
                      }}
                      className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                        autoWorldviewMode === option.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-secondary-200 bg-white hover:bg-secondary-50'
                      }`}
                    >
                      <span className="block text-sm font-medium text-secondary-900">{option.label}</span>
                      <span className="mt-1 block text-xs text-secondary-500">{option.note}</span>
                    </button>
                  ))}
                </div>

                {autoWorldviewMode === 'realistic' && (
                  <div>
                    <label className="block text-xs font-medium text-secondary-600 mb-1">
                      现实背景
                    </label>
                    <textarea
                      value={autoRealisticWorldviewContext}
                      onChange={(event) => setAutoRealisticWorldviewContext(event.target.value)}
                      rows={3}
                      placeholder="例如：上世纪80年代东北县城；1990年代广州服装批发市场；2008年前后深圳互联网创业圈"
                      className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-secondary-900">升级体系</h4>
                  <p className="mt-1 text-xs text-secondary-500">
                    关闭后，世界观不会强行设计修炼境界、突破条件、副本和秘境。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { value: true, label: '有升级体系', note: '适合修炼、异能、系统、战力成长和资源争夺' },
                    { value: false, label: '没有升级体系', note: '适合都市、现代、现实、悬疑、职场、家庭和商战' },
                  ]).map(option => (
                    <button
                      key={String(option.value)}
                      type="button"
                      disabled={autoWorldviewMode === 'realistic' && option.value}
                      onClick={() => setAutoNeedsUpgradeSystem(option.value)}
                      className={`text-left px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        autoNeedsUpgradeSystem === option.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-secondary-200 bg-white hover:bg-secondary-50'
                      }`}
                    >
                      <span className="block text-sm font-medium text-secondary-900">{option.label}</span>
                      <span className="mt-1 block text-xs text-secondary-500">{option.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-secondary-900">运行方式</h4>
                  <p className="mt-1 text-xs text-secondary-500">
                    选择中途暂停后，系统会保存当前项目并跳到对应页面，方便确认、清空重生成或直接参与修改。
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { value: 'none' as const, label: '跑到最后', note: '自动完成设定、小故事、正文写作和导出' },
                    { value: 'density' as const, label: '停在中故事迭代后', note: '三滑块第一次迭代完成后，进入人设与世界观查看中故事' },
                    { value: 'first-micro-story' as const, label: '停在第一批小故事后', note: '生成第一批剧集/章节细纲后，进入情节结构细化查看' },
                  ]).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAutoPauseMode(option.value)}
                      className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                        autoPauseMode === option.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-secondary-200 bg-white hover:bg-secondary-50'
                      }`}
                    >
                      <span className="block text-sm font-medium text-secondary-900">{option.label}</span>
                      <span className="mt-1 block text-xs text-secondary-500">{option.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={autoClearExisting}
                  onChange={(e) => setAutoClearExisting(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                />
                <span>
                  <span className="block text-sm font-medium text-secondary-900">开始前清除本书自动化缓存，重新生成</span>
                  <span className="mt-1 block text-xs text-secondary-500">
                    取消勾选会优先复用24小时内缓存，适合从上次结果继续检查。
                  </span>
                </span>
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-5 bg-secondary-50 border-t border-secondary-100">
              <button
                type="button"
                onClick={() => {
                  setIsAutoSetupOpen(false);
                  handleEnterWorldSetting();
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-secondary-200 text-secondary-800 text-sm font-medium hover:bg-secondary-100"
              >
                <BookOpen className="w-4 h-4" />
                <span>进入人设与世界观</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAutoSetupOpen(false)}
                  className="px-4 py-2.5 rounded-lg bg-white border border-secondary-200 text-secondary-700 text-sm font-medium hover:bg-secondary-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleStartAutoLiteraryIteration}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>开始自动迭代</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 一键自动生成进度条 */}
      <AutoGenerationProgress
        steps={steps}
        isVisible={isAutoGenerating}
        onCancel={cancelAutoGeneration}
        currentStepMessage={currentStepMessage}
      />
    </div>
  );
}

function App() {
  const [currentPage, setCurrentPage] = useState<'blueprint' | 'world-setting' | 'story-structure' | 'writer'>('blueprint');
  const [selectedOutline, setSelectedOutline] = useState<OutlineData | null>(null);

  const cacheOutlineSafely = (outline: OutlineData | null) => {
    if (!outline) {
      localStorage.removeItem('story-architect-current-outline');
      return;
    }

    const cachedOutline: OutlineData = {
      id: outline.id,
      title: (outline.title || '').slice(0, 200),
      aliasTitle: (outline.aliasTitle || '').slice(0, 200),
      aliasSynopsis: (outline.aliasSynopsis || '').slice(0, 1000),
      aliasTags: outline.aliasTags || [],
      logline: (outline.logline || '').slice(0, 2000),
      hook: (outline.hook || '').slice(0, 2000),
      characters: (outline.characters || '').slice(0, 2000),
      world: (outline.world || '').slice(0, 2000),
      themes: (outline.themes || '').slice(0, 2000),
      rawContent: '',
      preferredLlmModelProvider: outline.preferredLlmModelProvider,
      preferredLlmModel: outline.preferredLlmModel,
    };

    try {
      localStorage.setItem('story-architect-current-outline', JSON.stringify(cachedOutline));
    } catch (error) {
      console.warn('缓存当前灵感架构失败，忽略缓存继续流程:', error);
    }
  };

  // 自动化流程状态

  // 从localStorage恢复selectedOutline
  useEffect(() => {
    try {
      const saved = localStorage.getItem('story-architect-current-outline');
      if (saved) {
        const outline = JSON.parse(saved);
        setSelectedOutline(outline);
      }
    } catch (error) {
      console.error('Failed to load current outline:', error);
    }
  }, []);

  const handleNavigate = (page: string, outline?: OutlineData, shouldNavigateToStructure?: boolean) => {
    if (page === 'world-setting') {
      if (outline) {
        setSelectedOutline(outline);
      } else {
        setSelectedOutline(null);
      }
      setCurrentPage('world-setting');
      cacheOutlineSafely(outline || null);
    } else if (page === 'story-structure') {
      setCurrentPage('story-structure');
    } else if (page === 'writer') {
      // 如果指定了shouldNavigateToStructure，则先跳转到情节结构细化界面
      if (shouldNavigateToStructure) {
        console.log('一键生成完成，跳转到情节结构细化界面');
        setCurrentPage('story-structure');
      } else {
        setCurrentPage('writer');
      }
    } else {
      setCurrentPage('blueprint');
      setSelectedOutline(null);
      cacheOutlineSafely(null);
    }
  };

  const handleBack = (targetPage?: string) => {
    if (targetPage === 'world-setting') {
      setCurrentPage('world-setting');
    } else {
      setCurrentPage('blueprint');
      setSelectedOutline(null);
      cacheOutlineSafely(null);
    }
  };

  return (
    <SavedOutlinesProvider>
      <WorldSettingsProvider>
        {currentPage === 'blueprint' ? (
          <BlueprintPage
            onNavigate={handleNavigate}
          />
        ) : currentPage === 'world-setting' ? (
          <WorldSettingPage
            onBack={handleBack}
            onNavigateToStructure={() => handleNavigate('story-structure')}
            selectedOutline={selectedOutline}
          />
        ) : currentPage === 'story-structure' ? (
          <StoryStructurePage
            onBack={handleBack}
            onNavigateToWriter={() => setCurrentPage('writer')}
          />
        ) : (
          <WriterPage
            onBack={() => setCurrentPage('story-structure')}
          />
        )}
      </WorldSettingsProvider>
    </SavedOutlinesProvider>
  );
}

export default App;
