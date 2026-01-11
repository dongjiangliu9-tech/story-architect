import { useState, useEffect } from 'react';
// import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Sparkles, BookOpen, Wand2, Bookmark } from 'lucide-react';
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

function BlueprintPage({
  onNavigate
}: {
  onNavigate: (page: string, outline?: OutlineData) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<NovelCategory | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<NovelStyle | null>(null);
  const [theme, setTheme] = useState('');
  const [bookName, setBookName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [outlines, setOutlines] = useState<OutlineData[]>([]);
  const [currentOutlineIndex, setCurrentOutlineIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSavedPanelOpen, setIsSavedPanelOpen] = useState(false);

  // 一键生成功能
  const {
    isAutoGenerating,
    steps,
    currentStepMessage,
    cancelAutoGeneration
  } = useAutoGeneration();

  const handleGenerate = async () => {
    if (!selectedCategory || !selectedStyle || !theme.trim()) {
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
        style: selectedStyle.name,
        theme: theme.trim(),
      });

      // 解析AI返回的Markdown内容
      const parsedOutlines = parseOutlineContent(response.data);

      if (parsedOutlines.length === 0) {
        throw new Error('未能解析到有效的大纲内容');
      }

      setOutlines(parsedOutlines);
      setCurrentOutlineIndex(0);
    } catch (err) {
      console.error('生成失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };



  const handleNextOutline = () => {
    setCurrentOutlineIndex((prev) => (prev + 1) % outlines.length);
  };

  const handlePrevOutline = () => {
    setCurrentOutlineIndex((prev) => (prev - 1 + outlines.length) % outlines.length);
  };

  const handleLoadSavedOutline = (outline: OutlineData) => {
    // 将保存的大纲设置为当前显示的架构
    setOutlines([outline]);
    setCurrentOutlineIndex(0);
  };


  // 全流程自动化处理
  const handleAutoFlowGenerate = async () => {
    if (!selectedCategory || !selectedStyle || !theme.trim() || !outlines.length) {
      setError('请先选择频道、风格、输入主题并生成至少一个故事架构');
      return;
    }

    if (!bookName.trim()) {
      setError('请输入书名');
      return;
    }

    setError(null);

    try {
      // 设置自动化标志并跳转到人设与世界观界面
      localStorage.setItem('story-architect-auto-flow', 'start');
      localStorage.setItem('story-architect-book-name', bookName.trim());

      // 跳转到人设与世界观界面
      onNavigate('world-setting', outlines[currentOutlineIndex]);

    } catch (error) {
      console.error('全流程自动化启动失败:', error);
      setError('全流程自动化启动失败，请稍后重试');
    }
  };


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
                  selectedStyle={selectedStyle}
                  onSelectStyle={setSelectedStyle}
                />

                <ThemeInput
                  value={theme}
                  onChange={setTheme}
                />

                {/* 书名输入 - 用于一键生成 */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-secondary-700">
                    书名 <span className="text-red-500">*</span>
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
                  disabled={!selectedCategory || !selectedStyle || !theme.trim() || isGenerating}
                  isLoading={isGenerating}
                />

                {/* 全流程自动化生成按钮 */}
                {outlines.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <div className="text-center">
                      <div className="w-full h-px bg-gradient-to-r from-transparent via-secondary-300 to-transparent mb-4"></div>
                      <p className="text-sm text-secondary-600 mb-4">智能全流程自动化生成</p>
                    </div>

                    <button
                      onClick={handleAutoFlowGenerate}
                      disabled={!bookName.trim()}
                      className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-3 ${
                        bookName.trim()
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white'
                          : 'bg-secondary-300 text-secondary-500 cursor-not-allowed'
                      }`}
                    >
                      <Sparkles className="w-6 h-6" />
                      <div className="text-left">
                        <div className="font-bold">全流程自动化</div>
                        <div className="text-sm opacity-90">监听界面进度智能操作</div>
                      </div>
                    </button>


                    <div className="text-xs text-secondary-500 space-y-1">
                      <p>• 自动监听界面进度，从头到尾全流程监控</p>
                      <p>• 智能跳转界面并自动点击相应按钮</p>
                      <p>• 自动等待生成完成并继续下一环节</p>
                      <p>• 生成完成后自动保存并下载完整小说</p>
                    </div>
                  </div>
                )}

                {/* 跳转到World Setting按钮 */}
                {outlines.length > 0 && (
                  <button
                    onClick={() => onNavigate('world-setting', outlines[currentOutlineIndex])}
                    className="w-full btn btn-secondary py-3 flex items-center justify-center space-x-2"
                  >
                    <BookOpen className="w-5 h-5" />
                    <span>进入人设与世界观</span>
                  </button>
                )}
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
            ) : outlines.length > 0 ? (
              <div className="space-y-6">
                <OutlineNavigator
                  currentIndex={currentOutlineIndex}
                  total={outlines.length}
                  onPrev={handlePrevOutline}
                  onNext={handleNextOutline}
                />
                <OutlineCard
                  outline={outlines[currentOutlineIndex]}
                  className="animate-fade-in"
                />
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
    if (page === 'world-setting' && outline) {
      setSelectedOutline(outline);
      // 保存到localStorage以防页面刷新
      localStorage.setItem('story-architect-current-outline', JSON.stringify(outline));
      setCurrentPage('world-setting');
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
      // 清除localStorage中的临时数据
      localStorage.removeItem('story-architect-current-outline');
    }
  };

  const handleBack = (targetPage?: string) => {
    if (targetPage === 'world-setting') {
      setCurrentPage('world-setting');
    } else {
      setCurrentPage('blueprint');
      setSelectedOutline(null);
      // 清除localStorage中的临时数据
      localStorage.removeItem('story-architect-current-outline');
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