// React import not needed with jsx: "react-jsx"
import { useState, useEffect } from 'react';
import { ArrowLeft, BookOpen, Sparkles, FileText, Layers, ChevronRight, CheckCircle, Plus, RefreshCw, Eye, EyeOff, RotateCcw, PenTool } from 'lucide-react';
import { useWorldSettings, SavedMicroStory } from '../contexts/WorldSettingsContext';
import { blueprintApi } from '../services/api';
import { OutlineData } from '../types';

/**
 * 将OutlineData格式化为大纲字符串
 */
function formatOutlineData(outline: OutlineData): string {
  return `### ${outline.title}

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

interface StoryStructurePageProps {
  onBack: (targetPage?: string) => void;
  onNavigateToWriter?: () => void;
  setAutoFlowStep?: (step: string) => void;
  setAutoFlowProgress?: (progress: number) => void;
}

export function StoryStructurePage({ onBack, onNavigateToWriter, setAutoFlowStep, setAutoFlowProgress }: StoryStructurePageProps) {
  const { currentProject, updateProject } = useWorldSettings();
  const [selectedMacroStory, setSelectedMacroStory] = useState<string | null>(null);
  const [macroStories, setMacroStories] = useState<string[]>([]);
  const [microStoryOutlines, setMicroStoryOutlines] = useState<{[key: string]: string}>({});
  const [generatingStories, setGeneratingStories] = useState<{[key: string]: boolean}>({});
  const [expandedStories, setExpandedStories] = useState<{[key: string]: boolean}>({});
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{current: number, total: number, currentStory: string} | null>(null);


  // 解析中故事内容，正确提取【中故事X】标记之间的内容
  const parseMacroStories = (content: string): string[] => {
    const stories: string[] = [];

    // 匹配所有【中故事X】标记
    const storyRegex = /【中故事[一二三四五六七八九十\d]+】/g;
    const matches = [...content.matchAll(storyRegex)];

    if (matches.length === 0) {
      console.warn('未找到任何中故事标记');
      return [];
    }

    // 提取每个标记之后到下一个标记之前的内容
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

  // 重新生成中故事
  const regenerateMacroStories = async () => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    try {
      const response = await blueprintApi.generateDetailedOutline({
        outline: formatOutlineData(currentProject.outline),
        worldSetting: currentProject.worldSetting || '',
        characters: currentProject.characters || ''
      });

      console.log('重新生成的中故事内容:', response.data);

      // 更新项目
      await updateProject(currentProject.id, {
        detailedOutline: response.data
      });

      // 重新解析并设置中故事
      const newStories = parseMacroStories(response.data);
      setMacroStories(newStories);

      // 清除旧的小故事数据
      setMicroStoryOutlines({});
      await updateProject(currentProject.id, {
        microStoryOutlines: {}
      });

      alert('中故事已重新生成！');
    } catch (error) {
      console.error('重新生成中故事失败:', error);
      alert('重新生成中故事失败，请稍后重试');
    }
  };

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
        batchGenerateAndSaveMicroStories();
      }, 1000);
    }
  }, [currentProject, macroStories, setAutoFlowStep, setAutoFlowProgress]);


  // 将数字转换为中文数字
  const getChineseNumber = (num: number): string => {
    const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                           '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
                           '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十'];
    return chineseNumbers[num - 1] || num.toString();
  };

  // 计算中故事的章节范围
  const getChapterRange = (storyIndex: number) => {
    const chaptersPerMacroStory = 20;
    const startChapter = storyIndex * chaptersPerMacroStory + 1;
    const endChapter = (storyIndex + 1) * chaptersPerMacroStory;
    return { startChapter, endChapter };
  };

  // 检查中故事是否可以生成（前一个中故事必须已生成）
  const canGenerateStory = (storyIndex: number) => {
    if (storyIndex === 0) return true; // 第一个中故事总是可以生成
    const prevStoryKey = `story_${storyIndex - 1}`;
    return !!microStoryOutlines[prevStoryKey];
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
        macroStory,
        storyIndex: chineseIndex,
        chapterRange: `${chapterRange.startChapter}-${chapterRange.endChapter}`
      });

      console.log(`生成中故事${chineseIndex}的小故事细纲成功 (章节: ${chapterRange.startChapter}-${chapterRange.endChapter})`);

      // 保存到本地状态
      const newOutlines = { ...microStoryOutlines, [storyKey]: response.data };
      setMicroStoryOutlines(newOutlines);

      // 保存到项目
      if (currentProject) {
        updateProject(currentProject.id, {
          microStoryOutlines: newOutlines
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
  const batchGenerateAndSaveMicroStories = async () => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    if (macroStories.length < 3) {
      alert('需要至少3个中故事才能使用一键生成功能');
      return;
    }

    try {
      // 根据已保存的小故事数量计算应该生成哪几个中故事
      // 每个中故事有10个小故事
      const savedMicroStoriesCount = currentProject.savedMicroStories?.length || 0;
      const completedMacroStories = Math.floor(savedMicroStoriesCount / 10); // 已完成的中故事数量
      const startMacroStoryIndex = completedMacroStories; // 从下一个中故事开始

      // 检查是否有足够的未生成中故事
      const availableMacroStories = macroStories.length - startMacroStoryIndex;
      if (availableMacroStories <= 0) {
        alert(`所有中故事都已生成完毕！已保存 ${savedMicroStoriesCount} 个小故事。`);
        return;
      }

      // 确定要生成的中故事数量（最多3个）
      const targetCount = Math.min(3, availableMacroStories);
      const targetStories = macroStories.slice(startMacroStoryIndex, startMacroStoryIndex + targetCount);

      setBatchGenerating(true);
      setBatchGenerationProgress({ current: 0, total: targetCount, currentStory: '准备开始...' });

      console.log(`检测到已保存 ${savedMicroStoriesCount} 个小故事，相当于 ${completedMacroStories} 个中故事已完成`);
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
            macroStory,
            storyIndex: chineseIndex,
            chapterRange: `${chapterRange.startChapter}-${chapterRange.endChapter}`
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
          total: 3,
          currentStory: `正在保存中故事 ${storyIndex + 1} 的小故事...`
        });

        // 保存小故事
        const outlineContent = generatedOutlines[storyKey];
        if (outlineContent) {
          // 解析小故事内容
          const parseMicroStories = (content: string): string[] => {
            const stories: string[] = [];
            const microStoryRegex = /【小故事[一二三四五六七八九十\d]+】/g;
            const matches = [...content.matchAll(microStoryRegex)];

            for (let j = 0; j < matches.length; j++) {
              const currentMatch = matches[j];
              const nextMatch = matches[j + 1];

              const startIndex = currentMatch.index! + currentMatch[0].length;
              const endIndex = nextMatch ? nextMatch.index! : content.length;

              const storyContent = content.slice(startIndex, endIndex).trim();
              if (storyContent.length > 0) {
                stories.push(storyContent);
              }
            }
            return stories;
          };

          const microStoriesParsed = parseMicroStories(outlineContent);

          // 创建保存的小故事数据
          const savedMicroStories: SavedMicroStory[] = microStoriesParsed.map((content, index) => ({
            id: `${storyKey}_micro_${index}_${Date.now()}_${Math.random()}`,
            title: `小故事 ${getChineseNumber(index + 1)}`,
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

      // 保存所有小故事到项目
      updateProject(currentProject.id, {
        savedMicroStories: allSavedMicroStories
      });

      setBatchGenerationProgress({
        current: targetCount,
        total: targetCount,
        currentStory: '完成！正在跳转到正文写作...'
      });

      // 设置自动化标志，让WriterPage知道需要继续自动化
      localStorage.setItem('story-architect-auto-flow', 'writer');

      // 延迟跳转，让用户看到完成状态
      setTimeout(() => {
        console.log('情节结构细化完成，自动跳转到正文写作界面');
        onNavigateToWriter?.();
      }, 2000);

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
    const outlineContent = microStoryOutlines[storyKey];

    if (!outlineContent) {
      alert('没有找到小故事内容，请先生成小故事细纲');
      return;
    }

    // 解析小故事内容
    const parseMicroStories = (content: string): string[] => {
      const stories: string[] = [];
      const microStoryRegex = /【小故事[一二三四五六七八九十\d]+】/g;
      const matches = [...content.matchAll(microStoryRegex)];

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

    const microStories = parseMicroStories(outlineContent);

    // 创建保存的小故事数据
    const savedMicroStories: SavedMicroStory[] = microStories.map((content, index) => ({
      id: `${storyKey}_micro_${index}_${Date.now()}`,
      title: `小故事 ${getChineseNumber(index + 1)}`,
      content: cleanMicroStoryContent(content),
      macroStoryId: storyKey,
      macroStoryTitle: `中故事 ${storyIndex + 1}`,
      macroStoryContent: macroStory,
      order: index,
      createdAt: new Date().toISOString()
    }));

    // 获取现有的保存列表
    const existingSaved = currentProject.savedMicroStories || [];

    // 删除该中故事之前保存的所有小故事（完全覆盖）
    const filteredSaved = existingSaved.filter(existing =>
      existing.macroStoryId !== storyKey
    );

    // 检查是否有旧版本被覆盖
    const oldCount = existingSaved.length - filteredSaved.length;
    const hasOldVersion = oldCount > 0;

    // 更新项目 - 先删除旧的，再添加新的
    const updatedSaved = [...filteredSaved, ...savedMicroStories];
    updateProject(currentProject.id, {
      savedMicroStories: updatedSaved
    });

    const message = hasOldVersion
      ? `成功保存 ${savedMicroStories.length} 个小故事（已覆盖之前的 ${oldCount} 个小故事）！`
      : `成功保存 ${savedMicroStories.length} 个小故事！`;

    alert(message);
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
                onClick={regenerateMacroStories}
                className="flex items-center space-x-2 px-3 py-1.5 bg-orange-100 hover:bg-orange-200 rounded-lg text-orange-700 text-sm font-medium transition-colors"
                title="重新生成中故事"
              >
                <RotateCcw className="w-4 h-4" />
                <span>刷新中故事</span>
              </button>
              <button
                onClick={batchGenerateAndSaveMicroStories}
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
                    const savedCount = currentProject?.savedMicroStories?.length || 0;
                    const completedMacroStories = Math.floor(savedCount / 10);
                    const nextStart = completedMacroStories + 1;
                    const nextEnd = Math.min(completedMacroStories + 3, macroStories.length);
                    const availableCount = Math.max(0, macroStories.length - completedMacroStories);

                    if (availableCount === 0) {
                      return (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>全部生成完毕</span>
                        </>
                      );
                    } else {
                      return (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>生成第{nextStart}-{nextEnd}个</span>
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
                    <div className="text-sm text-secondary-600">已保存小故事</div>
                    <div className="text-xs text-secondary-400 mt-1">
                      可生成 {currentProject.savedMicroStories.length * 2} 章节
                    </div>
                  </div>

                  <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-3xl font-bold text-green-600 mb-2">
                      {currentProject.savedMicroStories.length * 4400}
                    </div>
                    <div className="text-sm text-secondary-600">预计总字数</div>
                    <div className="text-xs text-secondary-400 mt-1">
                      约{Math.round(currentProject.savedMicroStories.length * 4400 / 1000)}千字
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
                  onClick={onNavigateToWriter}
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
                <h2 className="text-lg font-semibold text-secondary-900">中故事列表</h2>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {macroStories.map((story, index) => {
                  const chapterRange = getChapterRange(index);
                  const hasGenerated = !!microStoryOutlines[`story_${index}`];
                  const canGenerate = canGenerateStory(index);
                  const isGenerating = generatingStories[`story_${index}`];

                  return (
                    <div
                      key={index}
                      onClick={() => canGenerate && setSelectedMacroStory(story)}
                      className={`p-4 rounded-lg border transition-all ${
                        !canGenerate
                          ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                          : selectedMacroStory === story
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
                              中故事 {index + 1}
                            </h3>
                            <span className="text-xs text-secondary-400 bg-secondary-100 px-2 py-1 rounded">
                              第{chapterRange.startChapter}-{chapterRange.endChapter}章
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
                                  已生成细纲
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
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      中故事 {macroStories.indexOf(selectedMacroStory) + 1} 内容
                    </h3>
                    <button
                      onClick={() => generateMicroStories(macroStories.indexOf(selectedMacroStory), selectedMacroStory)}
                      disabled={generatingStories[`story_${macroStories.indexOf(selectedMacroStory)}`]}
                      className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generatingStories[`story_${macroStories.indexOf(selectedMacroStory)}`] ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>生成中...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>生成小故事细纲</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                      {selectedMacroStory}
                    </div>
                  </div>
                </div>

                {/* 小故事细纲显示 */}
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      小故事细纲 (10个)
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => saveMicroStories(macroStories.indexOf(selectedMacroStory), selectedMacroStory)}
                        className="flex items-center space-x-2 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-md text-sm font-medium"
                        title="保存这些小故事到项目"
                      >
                        <Plus className="w-4 h-4" />
                        <span>保存小故事</span>
                      </button>
                      <button
                        onClick={() => toggleExpanded(macroStories.indexOf(selectedMacroStory))}
                        className="flex items-center space-x-2 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm hover:bg-secondary-200"
                      >
                        {expandedStories[`story_${macroStories.indexOf(selectedMacroStory)}`] ? (
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
                    const storyIndex = macroStories.indexOf(selectedMacroStory);
                    const storyKey = `story_${storyIndex}`;
                    const outlineContent = microStoryOutlines[storyKey];
                    const isExpanded = expandedStories[storyKey];

                    if (!outlineContent) {
                      return (
                        <div className="text-center py-8 text-secondary-500">
                          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>尚未生成小故事细纲</p>
                          <p className="text-sm mt-1">点击上方"生成小故事细纲"按钮</p>
                        </div>
                      );
                    }

                    // 解析小故事内容，正确提取【小故事X】标记之间的内容
                    const parseMicroStories = (content: string): string[] => {
                      const stories: string[] = [];
                      const microStoryRegex = /【小故事[一二三四五六七八九十\d]+】/g;
                      const matches = [...content.matchAll(microStoryRegex)];

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

                    const microStories = parseMicroStories(outlineContent);

                    return (
                      <div className="space-y-4">
                        {microStories.map((microStory, microIndex) => (
                          <div
                            key={microIndex}
                            className={`border border-secondary-200 rounded-lg p-4 transition-all ${
                              isExpanded ? '' : 'max-h-24 overflow-hidden'
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              <div className="flex-shrink-0 w-8 h-8 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-sm font-medium">
                                {microIndex + 1}
                              </div>
                              <div className="flex-1">
                                <h4 className="font-medium text-secondary-900 mb-2">
                                  小故事 {getChineseNumber(microIndex + 1)}
                                </h4>
                                <div className={`text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap ${
                                  isExpanded ? '' : 'line-clamp-3'
                                }`}>
                                  {cleanMicroStoryContent(microStory)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center">
                <FileText className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-secondary-900 mb-2">
                  选择一个中故事查看小故事细纲
                </h3>
                <p className="text-secondary-600">
                  点击左侧的中故事列表，选择要查看的小故事细纲
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
