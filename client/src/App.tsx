import { useState, useEffect } from 'react';
// import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Sparkles, BookOpen, Wand2, Bookmark, PenTool, FilePlus2, Save, X } from 'lucide-react';
import { NovelCategory, NovelStyle, OutlineData } from './types';
import { CategorySelector } from './components/CategorySelector';
import { StyleSelector } from './components/StyleSelector';
import { ThemeInput } from './components/ThemeInput';
import { GenerateButton } from './components/GenerateButton';
import { OutlineCard } from './components/OutlineCard';
import { OutlineNavigator } from './components/OutlineNavigator';
import { LoadingSpinner } from './components/LoadingSpinner';
import { SavedOutlinesPanel } from './components/SavedOutlinesPanel';
import { AutoGenerationProgress } from './components/AutoGenerationProgress';
import { WorldSettingPage } from './pages/WorldSettingPage';
import { WriterPage } from './pages/WriterPage';
import { SavedOutlinesProvider } from './contexts/SavedOutlinesContext';
import { WorldSettingsProvider } from './contexts/WorldSettingsContext';
import { StoryStructurePage } from './pages/StoryStructurePage';
import { blueprintApi } from './services/api';
import { parseOutlineContent } from './utils/outlineParser';
import { useAutoGeneration } from './hooks/useAutoGeneration';
import {
  DEFAULT_LOGIC_MODEL_VALUE,
  LOGIC_MODEL_OPTIONS,
  getPreferredLogicModelValue,
  toLogicModelRequest,
  toPreferredLogicModelFields,
} from './utils/llmModelSelection';

function BlueprintPage({
  onNavigate
}: {
  onNavigate: (page: string, outline?: OutlineData, shouldNavigateToStructure?: boolean) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<NovelCategory | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<NovelStyle[]>([]);
  const [theme, setTheme] = useState('');
  const [bookName, setBookName] = useState('');
  const [autoGenerationTarget, setAutoGenerationTarget] = useState<'microdrama-30' | 'novel-75'>('microdrama-30');
  const [logicModelValue, setLogicModelValue] = useState(() => {
    try {
      return localStorage.getItem('story-architect-logic-model') || DEFAULT_LOGIC_MODEL_VALUE;
    } catch {
      return DEFAULT_LOGIC_MODEL_VALUE;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [outlines, setOutlines] = useState<OutlineData[]>([]);
  const [currentOutlineIndex, setCurrentOutlineIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSavedPanelOpen, setIsSavedPanelOpen] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState<OutlineData | null>(null);
  const [editingOutlineIndex, setEditingOutlineIndex] = useState<number | null>(null);
  const [lastCommittedOutline, setLastCommittedOutline] = useState<OutlineData | null>(null);
  const isEditingOutline = outlineDraft !== null;
  const resolvedOutlineIndex =
    currentOutlineIndex >= 0 && currentOutlineIndex < outlines.length
      ? currentOutlineIndex
      : 0;
  const currentOutline = outlines[resolvedOutlineIndex] ?? null;

  const createCachedOutline = (outline: OutlineData): OutlineData => ({
    id: outline.id,
    title: (outline.title || '').slice(0, 200),
    logline: (outline.logline || '').slice(0, 2000),
    hook: (outline.hook || '').slice(0, 2000),
    characters: (outline.characters || '').slice(0, 2000),
    world: (outline.world || '').slice(0, 2000),
    themes: (outline.themes || '').slice(0, 2000),
    rawContent: '',
    preferredLlmModelProvider: outline.preferredLlmModelProvider,
    preferredLlmModel: outline.preferredLlmModel,
  });

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
      localStorage.setItem('story-architect-logic-model', logicModelValue);
    } catch {
      // Ignore localStorage failures so model selection never blocks generation.
    }
  }, [logicModelValue]);

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
      setOutlineDraft(null);
      setEditingOutlineIndex(null);
    } catch (err) {
      console.error('生成失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };



  const handleNextOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setCurrentOutlineIndex((prev) => (prev + 1) % outlines.length);
  };

  const handlePrevOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setCurrentOutlineIndex((prev) => (prev - 1 + outlines.length) % outlines.length);
  };

  const handleLoadSavedOutline = (outline: OutlineData) => {
    if (!confirmDiscardOutlineEdits()) return;
    // 将保存的大纲设置为当前显示的架构
    setOutlines([outline]);
    setCurrentOutlineIndex(0);
    setLastCommittedOutline(outline);
    setLogicModelValue(getPreferredLogicModelValue(outline));
    setOutlineDraft(null);
    setEditingOutlineIndex(null);
  };

  const startEditCurrentOutline = () => {
    const current = currentOutline;
    if (!current) return;
    setEditingOutlineIndex(resolvedOutlineIndex);
    setOutlineDraft({ ...current });
  };

  const startCreateBlankOutline = () => {
    if (!confirmDiscardOutlineEdits()) return;
    setEditingOutlineIndex(null);
    setOutlineDraft(createBlankOutline());
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
        return next;
      });
    } else {
      setLastCommittedOutline(normalizedOutline);
      setOutlines(prev =>
        prev.map((item, index) => (index === editingOutlineIndex ? normalizedOutline : item))
      );
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

  const handleStartAutoLiteraryIteration = () => {
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
      return;
    }

    const resolvedBookName = bookName.trim() || outline.title.trim() || '未命名作品';
    setError(null);

    try {
      localStorage.setItem('story-architect-current-outline', JSON.stringify(createCachedOutline(outline)));
    } catch (error) {
      console.warn('缓存当前灵感架构失败，继续启动自动流程:', error);
    }

    startAutoGeneration(
      outline,
      resolvedBookName,
      (_projectId, shouldNavigateToStructure) => {
        onNavigate(shouldNavigateToStructure ? 'story-structure' : 'writer', outline, shouldNavigateToStructure);
      },
      (message) => setError(message),
      { target: autoGenerationTarget }
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
                <span>我的保存</span>
              </button>
              <div className="flex items-center space-x-2 text-secondary-600">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm">Powered by Gemini 3 Pro</span>
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
                <CategorySelector
                  selectedCategory={selectedCategory}
                  onSelectCategory={setSelectedCategory}
                />

                <StyleSelector
                  selectedStyles={selectedStyles}
                  onChangeSelectedStyles={setSelectedStyles}
                />

                <ThemeInput
                  value={theme}
                  onChange={setTheme}
                />

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
                  onClick={handleStartAutoLiteraryIteration}
                  disabled={!hasOutlineForAutoGeneration || isGenerating || isAutoGenerating}
                  className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg flex items-center justify-center space-x-3 ${
                    !hasOutlineForAutoGeneration || isGenerating || isAutoGenerating
                      ? 'bg-secondary-200 text-secondary-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white hover:shadow-xl transform hover:scale-105'
                  }`}
                >
                  <Sparkles className="w-6 h-6" />
                  <span>{isAutoGenerating ? 'AI自动迭代中...' : `AI自动迭代文学作品（${autoGenerationTarget === 'microdrama-30' ? '30集' : '75章'}）`}</span>
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
                            <button
                              onClick={startEditCurrentOutline}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑当前架构</span>
                            </button>
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
                          金手指设定
                        </label>
                        <textarea
                          value={outlineDraft.themes}
                          onChange={(e) => updateOutlineDraft('themes', e.target.value)}
                          rows={4}
                          placeholder="外挂、能力成长路径、资源机制"
                          className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                ) : currentOutline ? (
                  <OutlineCard
                    outline={currentOutline}
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
