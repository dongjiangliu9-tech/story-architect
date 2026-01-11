// React import not needed with jsx: "react-jsx"
import { useState, useEffect } from 'react';
import { ArrowLeft, BookOpen, Sparkles, FileText, PenTool, RefreshCw, Save, Download, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { useWorldSettings } from '../contexts/WorldSettingsContext';
import { blueprintApi } from '../services/api';

interface WriterPageProps {
  onBack: () => void;
  setIsAutoFlowRunning?: (running: boolean) => void;
  setAutoFlowStep?: (step: string) => void;
  setAutoFlowProgress?: (progress: number) => void;
}

/**
 * 过滤AI风格的内容，去掉markdown符号等
 */
function cleanWriterContent(content: string): string {
  // 对于流式内容，我们需要更智能的处理
  let cleanedContent = content
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/`([^`]*)`/g, '$1') // 移除行内代码
    .replace(/\*\*([^*]*)\*\*/g, '$1') // 移除粗体
    .replace(/\*([^*]*)\*/g, '$1') // 移除斜体
    .replace(/^\s*#+\s*/gm, '') // 移除标题符号
    .replace(/^\s*[-*+]\s+/gm, '') // 移除列表符号
    .replace(/^\s*\d+\.\s+/gm, '') // 移除有序列表
    .replace(/^\s*>\s+/gm, '') // 移除引用符号
    .replace(/🌟|⭐|✨|🔥|💎|🎯|👥|📖|🎪|🏆|⚔️|🗡️|🏰|🧙|🐉|🦄|🌈|💫|🌙|☀️|🌟|⭐|✨|🔥|💎|🎯|👥|📖|🎪|🏆|⚔️|🗡️|🏰|🧙|🐉|🦄|🌈|💫|🌙|☀️/g, '') // 移除表情符号
    .replace(/\n{3,}/g, '\n\n'); // 压缩多余换行，但保留一些换行

  return cleanedContent.trim();
}

function getWordCount(content: string): number {
  // 移除标题行，然后计算中文字符数
  const lines = content.split('\n');
  const contentLines = lines.filter(line => !line.match(/^第\d+章\s*\[/)); // 过滤掉标题行
  const text = contentLines.join('\n');

  // 计算中文字符数（不包括英文和数字）
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  return chineseChars.length;
}

function getChapterRangeDisplay(chapterNumber: number): string {
  // 每2章为一组显示范围
  const startChapter = Math.floor((chapterNumber - 1) / 2) * 2 + 1;
  const endChapter = startChapter + 1;
  return `第${startChapter}～${endChapter}章`;
}

export function WriterPage({ onBack, setIsAutoFlowRunning, setAutoFlowStep, setAutoFlowProgress }: WriterPageProps) {
  const { currentProject, updateProject } = useWorldSettings();
  const [isGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const [currentChapter, setCurrentChapter] = useState(1);
  const [_totalChapters, setTotalChapters] = useState(0);
  const [previousChapterEnding, setPreviousChapterEnding] = useState<string>('');
  const [generatedChapters, setGeneratedChapters] = useState<{[key: number]: string}>({});
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isFullCycleGenerating, setIsFullCycleGenerating] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string>('');
  const [fullCycleProgress, setFullCycleProgress] = useState<{
    current: number;
    total: number;
    currentBatch: number;
    totalBatches: number;
    message: string;
    currentChapter?: number;
    currentChapterWords?: number;
  } | null>(null);
  const [generationState, setGenerationState] = useState<{
    isGenerating: boolean;
    currentGeneratingChapter: number | null;
    totalChapters: number;
    completedChapters: number[];
  }>({
    isGenerating: false,
    currentGeneratingChapter: null,
    totalChapters: 0,
    completedChapters: []
  });

  // 用于存储当前SSE连接的引用，以便终止时关闭
  const [currentEventSource, setCurrentEventSource] = useState<EventSource | null>(null);
  const [showSavedVersions, setShowSavedVersions] = useState(false);
  const [jumpToChapter, setJumpToChapter] = useState(currentChapter.toString());
  const [showChapterSelector, setShowChapterSelector] = useState(false);
  const [selectedStartChapter, setSelectedStartChapter] = useState<number | null>(null);
  const [isRegenerateMode, setIsRegenerateMode] = useState(false); // 是否为重新生成模式

  // 计算下一个需要生成的章节
  const getNextChapterToGenerate = (): number => {
    if (!currentProject?.savedMicroStories) return 1;

    const totalChapters = currentProject.savedMicroStories.length * 2;
    for (let chapter = 1; chapter <= totalChapters; chapter++) {
      if (!generatedChapters[chapter]) {
        return chapter;
      }
    }
    return 1; // 如果所有章节都已生成，返回1（这种情况不应该发生）
  };

  // Writer页面状态持久化key
  const WRITER_STATE_KEY = currentProject?.id ? `writer-state-${currentProject.id}` : 'writer-state-default';

  // 检查自动化流程
  useEffect(() => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    if (autoFlowFlag === 'writer' && currentProject?.savedMicroStories && currentProject.savedMicroStories.length > 0) {
      console.log('检测到自动化流程：开始自动执行一键循环生成');
      localStorage.removeItem('story-architect-auto-flow');

      // 更新自动化状态
      if (setAutoFlowStep) setAutoFlowStep('正在自动点击"一键循环生成"...');
      if (setAutoFlowProgress) setAutoFlowProgress(100);

      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        generateFullCycleContent();
      }, 1000);
    }
  }, [currentProject?.savedMicroStories, setAutoFlowStep, setAutoFlowProgress]);

  // 从localStorage和项目中恢复状态
  useEffect(() => {
    // 检查是否为自动生成模式，如果是则自动启动章节生成
    // 只有在完全没有生成过任何章节的情况下才会自动启动，避免干扰手动操作
    const hasGeneratedChapters = Object.keys(generatedChapters).length > 0;
    const shouldAutoStart = currentProject?.autoSelectedStories &&
        !currentProject?.autoGenerationStarted &&
        !hasGeneratedChapters &&
        !generationState.isGenerating &&
        currentProject?.selectedMicroStories &&
        currentProject.selectedMicroStories.length > 0;

    if (shouldAutoStart) {
      console.log('检测到自动选择的小故事，准备自动启动章节生成...');
      console.log(`已选择 ${currentProject.selectedMicroStories?.length || 0} 个小故事用于生成`);

      // 使用requestAnimationFrame确保在下一个渲染周期执行，避免竞态条件
      const startAutoGeneration = () => {
        // 再次检查条件，确保没有其他操作正在进行
        if (!generationState.isGenerating &&
            !hasGeneratedChapters &&
            currentProject?.selectedMicroStories &&
            currentProject.selectedMicroStories.length > 0) {

          console.log('自动启动8章批量生成...');
          generateBatchContent();
        }
      };

      // 延迟执行，确保组件完全挂载
      setTimeout(startAutoGeneration, 1000);
    }

    // 在组件挂载时立即尝试恢复状态
    const tryRestoreState = () => {
      try {
        // 首先从项目中恢复保存的章节内容
        if (currentProject?.generatedChapters) {
          setGeneratedChapters(currentProject.generatedChapters);
          console.log('从项目中恢复了生成的内容:', Object.keys(currentProject.generatedChapters).length, '个章节');
        }

        // 然后从localStorage恢复临时的状态
        const savedState = localStorage.getItem(WRITER_STATE_KEY);
        if (savedState) {
          const state = JSON.parse(savedState);
          setGeneratedContent(state.generatedContent || '');
          const restoredChapter = state.currentChapter || 1;
          setCurrentChapter(restoredChapter);
          setJumpToChapter(restoredChapter.toString());
          setPreviousChapterEnding(state.previousChapterEnding || '');
          // 合并项目中的章节和localStorage中的章节
          const mergedChapters = { ...currentProject?.generatedChapters, ...state.generatedChapters };
          setGeneratedChapters(mergedChapters);
          setGenerationState(state.generationState || {
            isGenerating: false,
            currentGeneratingChapter: null,
            totalChapters: 0,
            completedChapters: []
          });
          console.log('从localStorage恢复了Writer页面状态');
        } else if (currentProject?.generatedChapters && Object.keys(currentProject.generatedChapters).length > 0) {
          // 如果只有项目中有内容，设置当前章节为第一个
          const firstChapter = Math.min(...Object.keys(currentProject.generatedChapters).map(Number));
          setCurrentChapter(firstChapter);
          setJumpToChapter(firstChapter.toString());
          setGeneratedContent(currentProject.generatedChapters[firstChapter]);
        }
      } catch (error) {
        console.error('恢复Writer页面状态失败:', error);
      }
    };

    // 立即尝试恢复
    tryRestoreState();

    // 如果currentProject还没有加载，也尝试恢复（使用默认key）
    if (!currentProject?.id) {
      const defaultKey = 'writer-state-default';
      try {
        const savedState = localStorage.getItem(defaultKey);
        if (savedState) {
          const state = JSON.parse(savedState);
          setGeneratedContent(state.generatedContent || '');
          setCurrentChapter(state.currentChapter || 1);
          setPreviousChapterEnding(state.previousChapterEnding || '');
          setGeneratedChapters(state.generatedChapters || {});
          setGenerationState(state.generationState || {
            isGenerating: false,
            currentGeneratingChapter: null,
            totalChapters: 0,
            completedChapters: []
          });
          console.log('使用默认key恢复了Writer页面状态');
        }
      } catch (error) {
        console.error('使用默认key恢复Writer页面状态失败:', error);
      }
    }
  }, []); // 只在组件挂载时执行一次

  // 保存状态到localStorage
  const saveWriterState = () => {
    try {
      const state = {
        generatedContent,
        currentChapter,
        previousChapterEnding,
        generatedChapters,
        generationState,
        timestamp: Date.now()
      };

      // 保存到项目特定的key
      if (currentProject?.id) {
        localStorage.setItem(WRITER_STATE_KEY, JSON.stringify(state));
      }

      // 同时保存到默认key，确保能恢复
      localStorage.setItem('writer-state-default', JSON.stringify(state));
      console.log('Writer页面状态已保存到localStorage');
    } catch (error) {
      console.error('保存Writer页面状态失败:', error);
    }
  };

  // 定期保存状态（每30秒）
  useEffect(() => {
    const interval = setInterval(saveWriterState, 30000);
    return () => clearInterval(interval);
  }, [generatedContent, currentChapter, previousChapterEnding, generatedChapters, generationState]);

  // 离开页面时保存状态
  useEffect(() => {
    return () => {
      saveWriterState();
    };
  }, []);

  // 监听章节切换和内容更新，确保显示最新内容
  useEffect(() => {
    if (generatedChapters[currentChapter]) {
      setGeneratedContent(generatedChapters[currentChapter]);
    }
  }, [currentChapter, generatedChapters]);

  // 保存生成的内容到项目
  const saveGeneratedContent = () => {
    if (!currentProject || Object.keys(generatedChapters).length === 0) {
      alert('没有可保存的内容');
      return;
    }

    // 创建保存版本
    const saveVersion = {
      id: `save_${Date.now()}`,
      timestamp: new Date().toISOString(),
      chapterCount: Object.keys(generatedChapters).length,
      totalWords: Object.values(generatedChapters).reduce((sum, content) => sum + getWordCount(content), 0),
      chapters: { ...generatedChapters },
      preview: Object.values(generatedChapters)[0]?.substring(0, 200) + '...' || ''
    };

    // 获取现有保存版本
    const existingVersions = currentProject.savedVersions || [];

    // 保存到项目中
    updateProject(currentProject.id, {
      generatedChapters: { ...generatedChapters },
      savedVersions: [saveVersion, ...existingVersions].slice(0, 10) // 保留最近10个版本
    });

    console.log('保存生成的内容:', generatedChapters);
    alert('内容已保存！版本历史已更新。');
  };

  // 恢复保存的版本
  const restoreSavedVersion = (versionId: string) => {
    if (!currentProject?.savedVersions) return;

    const version = currentProject.savedVersions.find(v => v.id === versionId);
    if (version) {
      setGeneratedChapters(version.chapters);
      setCurrentChapter(Math.min(...Object.keys(version.chapters).map(Number)));
      setGeneratedContent(version.chapters[Math.min(...Object.keys(version.chapters).map(Number))]);
      setShowSavedVersions(false);
      alert(`已恢复到 ${new Date(version.timestamp).toLocaleString()} 保存的版本`);
    }
  };

  // 跳转到指定章节
  const jumpToChapterGroup = () => {
    const targetChapter = parseInt(jumpToChapter);
    if (isNaN(targetChapter) || targetChapter < 1) {
      alert('请输入有效的章节编号');
      return;
    }

    const availableChapters = Object.keys(generatedChapters).map(Number);
    console.log('可用的章节:', availableChapters);
    console.log('目标章节:', targetChapter);
    console.log('generatedChapters:', generatedChapters);

    if (availableChapters.includes(targetChapter)) {
      setCurrentChapter(targetChapter);
      setGeneratedContent(generatedChapters[targetChapter] || '');
      setJumpToChapter(targetChapter.toString()); // 保持当前值而不是清空
    } else {
      alert(`第${targetChapter}章还未生成。可用章节: ${availableChapters.join(', ')}`);
    }
  };

  // 导出生成的内容
  const exportGeneratedContent = () => {
    if (Object.keys(generatedChapters).length === 0) {
      alert('没有可导出的内容');
      return;
    }

    // 将所有生成的章节合并成一个文档
    const allChapters = Object.keys(generatedChapters)
      .map(Number)
      .sort((a, b) => a - b)
      .map(chapterNum => generatedChapters[chapterNum])
      .join('\n\n');

    const projectTitle = currentProject?.bookName || '小说正文';
    const exportContent = `${projectTitle}\n\n${allChapters}`;

    // 创建下载
    const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('内容已导出');
  };

  // 导出为DOCX格式
  const exportAsDocx = async () => {
    if (Object.keys(generatedChapters).length === 0) {
      alert('没有可导出的内容');
      return;
    }

    try {
      const projectTitle = currentProject?.bookName || '小说正文';

      const response = await blueprintApi.exportAsDocx({
        chapters: generatedChapters,
        bookName: projectTitle
      });

      if (response.success) {
        // 创建下载
        const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('DOCX内容已导出');
      } else {
        alert('导出失败，请稍后重试');
      }
    } catch (error) {
      console.error('导出DOCX失败:', error);
      alert('导出失败，请稍后重试');
    }
  };

  // 终止生成
  const stopGeneration = async () => {
    if (!generationState.isGenerating) return;

    const confirmed = confirm('确定要终止当前生成吗？已完成的章节会保留，未完成的章节会被丢弃。');
    if (!confirmed) return;

    try {
      // 关闭SSE连接
      if (currentEventSource) {
        currentEventSource.close();
        setCurrentEventSource(null);
        console.log('SSE连接已关闭');
      }

      // 调用API终止后台生成
      await blueprintApi.cancelGeneration(currentRequestId);
      console.log('已发送终止请求到后台');
    } catch (error) {
      console.error('终止生成失败:', error);
    }

    // 重置生成状态，但保留已完成的章节
    setGenerationState({
      isGenerating: false,
      currentGeneratingChapter: null,
      totalChapters: 0,
      completedChapters: []
    });

    // 清除正在生成的内容，但保留已完成的章节
    setGeneratedContent('');
    if (Object.keys(generatedChapters).length > 0) {
      const firstCompletedChapter = Math.min(...Object.keys(generatedChapters).map(Number));
      setCurrentChapter(firstCompletedChapter);
      setGeneratedContent(generatedChapters[firstCompletedChapter]);
    }

    // 保存当前状态
    saveWriterState();

    alert('生成已终止，已完成的章节已保存。');
  };

  // 重置生成状态
  const resetGeneration = () => {
    const confirmed = confirm('确定要重置吗？这将清除所有已生成的章节内容，返回空白状态。');
    if (!confirmed) return;

    // 重置所有状态到初始空白状态
    setGeneratedContent('');
    setCurrentChapter(1);
    setPreviousChapterEnding('');
    setGeneratedChapters({});
    setCurrentRequestId('');
    setGenerationState({
      isGenerating: false,
      currentGeneratingChapter: null,
      totalChapters: 0,
      completedChapters: []
    });

    // 清除localStorage中的所有相关状态
    localStorage.removeItem(WRITER_STATE_KEY);
    localStorage.removeItem('writer-state-default');

    alert('已重置到空白状态，可以重新开始写作。');
  };

  useEffect(() => {
    // 初始化章节信息
    if (currentProject?.savedMicroStories) {
      // 计算总章节数
      const totalStories = currentProject.savedMicroStories.length;
      const calculatedTotalChapters = Math.floor(totalStories * 2); // 每个小故事2章
      setTotalChapters(calculatedTotalChapters);

      // 设置当前章节为下一个需要生成的
      // 这里可以根据已生成的内容来确定，但暂时设为1
      setCurrentChapter(1);
    }
  }, [currentProject]);


  // 批量生成8章内容
  const generateBatchContent = async (expectedStartChapter?: number, expectedChapterCount?: number) => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    // 优先使用已选择的小故事，否则使用所有保存的小故事
    const microStoriesToUse = currentProject.selectedMicroStories || currentProject.savedMicroStories;

    // 如果是全流程自动生成，允许生成更少的小故事；手动生成时保持原有要求
    const isAutoFlow = expectedStartChapter !== undefined && expectedChapterCount !== undefined;
    if (!isAutoFlow && (!microStoriesToUse || microStoriesToUse.length < 4)) {
      alert('需要至少保存4个小故事才能进行批量生成');
      return;
    }

    setIsBatchGenerating(true);

    try {
      const generationContext = buildGenerationContext();
      console.log('批量生成上下文长度:', generationContext.length);

      // 计算起始章节
      const existingChapters = Object.keys(generatedChapters).length;
      const startChapter = existingChapters > 0
        ? Math.max(...Object.keys(generatedChapters).map(Number)) + 1
        : 1;

      console.log('开始流式生成8章内容...');

      // 初始化生成状态
      setGenerationState({
        isGenerating: true,
        currentGeneratingChapter: startChapter,
        totalChapters: 8,
        completedChapters: []
      });

      // 先准备流式请求，获取requestId
      const prepareResponse = await blueprintApi.prepareChapterStream({
        context: generationContext,
        chapterNumber: startChapter,
        previousEnding: previousChapterEnding || undefined,
        savedMicroStories: microStoriesToUse,
        generatedChapters: startChapter >= 9 ? generatedChapters : undefined
      });

      const requestId = prepareResponse.requestId;
      setCurrentRequestId(requestId);
      console.log('获取到requestId:', requestId);

      // 使用SSE进行流式生成
      const eventSource = blueprintApi.generateChapterStream(requestId);
      setCurrentEventSource(eventSource); // 保存SSE连接引用

      let generatedChaptersData: {[key: number]: string} = {};

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('收到SSE消息:', data.type, data.chapter || '');

          switch (data.type) {
            case 'start':
              console.log(data.message);
              setGenerationState(prev => ({
                ...prev,
                isGenerating: true,
                totalChapters: 8 // 生成8章内容
              }));
              break;

            case 'story_start':
              console.log(data.message);
              setGenerationState(prev => ({
                ...prev,
                currentGeneratingChapter: data.chapters[0] // 设置当前生成的第一章
              }));
              // 自动切换到正在生成的小故事第一章，开始实时显示内容
              setCurrentChapter(data.chapters[0]);
              setGeneratedContent(''); // 清空内容，准备显示新的小故事
              break;

            case 'story_chunk':
              if (data.content) {
                const cleanContent = cleanWriterContent(data.content);

                // 实时显示小故事生成过程
                setGeneratedContent(cleanContent);
                console.log(`第${data.storyIndex}个小故事实时更新，当前长度: ${cleanContent.length}`);
              }
              break;

            case 'chapter_complete':
              if (data.content) {
                const cleanContent = cleanWriterContent(data.content);
                generatedChaptersData[data.chapter] = cleanContent;

                // 更新状态
                setGeneratedChapters(prev => ({ ...prev, [data.chapter]: cleanContent }));

                // 更新生成状态
                setGenerationState(prev => ({
                  ...prev,
                  completedChapters: [...prev.completedChapters, data.chapter],
                  currentGeneratingChapter: data.chapter + 1 <= prev.totalChapters ? data.chapter + 1 : null
                }));

                // 如果当前查看的就是这个章节，显示最终的章节内容
                if (data.chapter === currentChapter) {
                  setGeneratedContent(cleanContent);
                }

                console.log(`第${data.chapter}章生成完成，字数: ${getWordCount(cleanContent)}`);
              }
              break;

            case 'story_complete':
              console.log(`第${data.storyIndex}个小故事生成完成`);
              // 小故事完成，等待章节分割
              break;

            case 'cancelled':
              console.log(data.message);
              setGenerationState({
                isGenerating: false,
                currentGeneratingChapter: null,
                totalChapters: 0,
                completedChapters: []
              });
              eventSource.close();
              setCurrentEventSource(null);
              setIsBatchGenerating(false);
              alert('生成已被终止');
              break;

            case 'story_error':
              console.error(data.error);
              // 继续处理，不中断整个流程
              break;

            case 'complete':
              console.log(data.message);

              try {
                // 更新previousChapterEnding
                const chapterKeys = Object.keys(generatedChaptersData).map(Number).sort((a, b) => a - b);
                if (chapterKeys.length > 0) {
                  const lastChapterNum = Math.max(...chapterKeys);
                  const lastChapterContent = generatedChaptersData[lastChapterNum];
                  if (lastChapterContent) {
                    const lines = lastChapterContent.split('\n');
                    const lastLines = lines.slice(-10).join('\n');
                    setPreviousChapterEnding(lastLines);
                  }
                }

                // 合并新生成的章节到总章节中
                setGeneratedChapters(prev => ({ ...prev, ...generatedChaptersData }));

                // 重置生成状态
                const totalGenerated = Object.keys(generatedChapters).length + Object.keys(generatedChaptersData).length;
                setGenerationState({
                  isGenerating: false,
                  currentGeneratingChapter: null,
                  totalChapters: 0,
                  completedChapters: []
                });

                console.log(`批量生成完成！共生成了${totalGenerated}个章节的内容`);
                if (totalGenerated >= 8) {
                  alert(`第一批8章生成完成！现在可以点击"继续生成9~16章"按钮生成后续内容`);
                } else {
                  alert(`批量生成完成！共生成了${totalGenerated}个章节的内容`);
                }
                eventSource.close();
                setCurrentEventSource(null);
                setIsBatchGenerating(false);
              } catch (error) {
                console.error('处理完成事件时出现错误:', error);
                // 发生错误时也要重置状态，避免界面卡死
                setGenerationState({
                  isGenerating: false,
                  currentGeneratingChapter: null,
                  totalChapters: 0,
                  completedChapters: []
                });
                setIsBatchGenerating(false);
                alert('生成过程中出现错误，但已保存已完成的内容');
              }
              break;
          }
        } catch (error) {
          console.error('解析SSE消息失败:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE连接错误:', error);
        alert('生成过程中出现错误，请稍后重试');
        eventSource.close();
        setCurrentEventSource(null);
        setIsBatchGenerating(false);
      };

    } catch (error) {
      console.error('批量生成章节内容失败:', error);
      alert('生成失败，请稍后重试');
      setIsBatchGenerating(false);
    }
  };

  // 从指定章节开始生成后续内容（支持覆盖模式）
  const generateFromChapter = async (startChapter: number, isOverwriteMode: boolean = false) => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    const microStoriesToUse = currentProject.savedMicroStories;
    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      alert('没有找到保存的小故事，请先在情节结构细化页面生成并保存小故事');
      return;
    }

    // 计算总章节数：每个小故事对应2个章节
    const totalChapters = microStoriesToUse.length * 2;

    // 检查起始章节是否有效
    if (startChapter < 1 || startChapter > totalChapters) {
      alert(`起始章节无效。可用范围：第1-${totalChapters}章`);
      return;
    }

    // 如果是覆盖模式，给用户确认提示
    if (isOverwriteMode && Object.keys(generatedChapters).length > 0) {
      const hasContentAfterStart = Object.keys(generatedChapters).some(chapter => parseInt(chapter) >= startChapter);
      if (hasContentAfterStart) {
        const confirmed = confirm(`⚠️ 覆盖模式确认\n\n从第${startChapter}章开始重新生成将覆盖现有的章节内容。\n\n这将删除第${startChapter}章及之后的所有已生成内容，然后重新生成。\n\n确定要继续吗？`);
        if (!confirmed) return;
      }
    }

    // 计算还需要生成多少章
    const remainingChapters = totalChapters - startChapter + 1;
    if (remainingChapters <= 0) {
      alert('所有章节都已生成完毕！');
      return;
    }

    const totalBatches = Math.ceil(remainingChapters / 8); // 每8章一批

    const modeText = isOverwriteMode ? '重新生成' : '继续生成';
    console.log(`从第${startChapter}章开始${modeText}，共需生成 ${remainingChapters} 个章节，分为 ${totalBatches} 批次`);

    setIsFullCycleGenerating(true);
    setFullCycleProgress({
      current: 0,
      total: remainingChapters,
      currentBatch: 1,
      totalBatches,
      message: `准备从第${startChapter}章开始${modeText}...`
    });

    try {
      let totalGeneratedSoFar = startChapter - 1; // 已生成的章节数
      let currentBatch = 1;
      let accumulatedChapters: {[key: number]: string} = { ...generatedChapters };

      // 如果是覆盖模式，清除从起始章节开始的所有内容
      if (isOverwriteMode) {
        Object.keys(accumulatedChapters).forEach(chapter => {
          if (parseInt(chapter) >= startChapter) {
            delete accumulatedChapters[parseInt(chapter)];
          }
        });
        console.log(`覆盖模式：已清除第${startChapter}章及之后的所有内容`);
      }

      while (currentBatch <= totalBatches) {
        const batchStartChapter = totalGeneratedSoFar + 1;
        const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);
        const batchChapterCount = batchEndChapter - batchStartChapter + 1;

        setFullCycleProgress({
          current: totalGeneratedSoFar - (startChapter - 1),
          total: remainingChapters,
          currentBatch,
          totalBatches,
          message: `正在${modeText}第${currentBatch}批 (章节 ${batchStartChapter}-${batchEndChapter})...`
        });

        console.log(`从指定章节开始：第${currentBatch}批：章节 ${batchStartChapter}-${batchEndChapter}`);

        const batchResult = await simulateBatchGeneration(batchStartChapter, batchChapterCount, accumulatedChapters);
        accumulatedChapters = { ...batchResult };

        totalGeneratedSoFar += batchChapterCount;
        currentBatch++;
      }

      setFullCycleProgress({
        current: remainingChapters,
        total: remainingChapters,
        currentBatch: totalBatches,
        totalBatches,
        message: `所有后续章节${modeText}完成！`
      });

      setTimeout(() => {
        alert(`从第${startChapter}章开始${modeText}完成！共生成 ${remainingChapters} 个章节内容。`);
        setIsFullCycleGenerating(false);
        setFullCycleProgress(null);
        setShowChapterSelector(false);
      }, 1000);

    } catch (error) {
      console.error('从指定章节开始生成失败:', error);
      alert('生成过程中出现错误，请稍后重试');
      setIsFullCycleGenerating(false);
      setFullCycleProgress(null);
    }
  };

  // 一键循环生成所有章节内容 - 模拟用户交互方式
  const generateFullCycleContent = async () => {
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    const microStoriesToUse = currentProject.savedMicroStories;

    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      alert('没有找到保存的小故事，请先在情节结构细化页面生成并保存小故事');
      return;
    }

    // 计算总章节数：每个小故事对应2个章节
    const totalChapters = microStoriesToUse.length * 2;
    const totalBatches = Math.ceil(totalChapters / 8); // 每8章一批

    console.log(`开始一键循环生成，共 ${microStoriesToUse.length} 个小故事，${totalChapters} 个章节，分为 ${totalBatches} 批次`);

    setIsFullCycleGenerating(true);
    setFullCycleProgress({
      current: 0,
      total: totalChapters,
      currentBatch: 1,
      totalBatches,
      message: '准备开始生成...'
    });

    try {
      // 【关键修复】使用本地变量跟踪已生成的章节数和内容，避免依赖异步React状态
      let totalGeneratedSoFar = 0;
      let currentBatch = 1;
      let accumulatedChapters: {[key: number]: string} = { ...generatedChapters }; // 累积所有生成的章节

      // 循环生成每一批8章内容
      while (currentBatch <= totalBatches) {
        // 【关键】使用本地变量而非异步状态来计算批次信息
        const batchStartChapter = totalGeneratedSoFar + 1;
        const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters); // 每批最多8章

        setFullCycleProgress({
          current: totalGeneratedSoFar,
          total: totalChapters,
          currentBatch,
          totalBatches,
          message: `正在生成第${currentBatch}批 (章节 ${batchStartChapter}-${batchEndChapter})...`
        });

        console.log(`模拟用户点击：开始生成第${currentBatch}批：章节 ${batchStartChapter}-${batchEndChapter}`);

        // 模拟用户点击"批量生成"按钮 - 等待完成
        // 【关键】传入正确的起始章节、章节数量和累积的章节数据，避免函数内部依赖异步状态
        const batchChapterCount = batchEndChapter - batchStartChapter + 1;
        const batchResult = await simulateBatchGeneration(batchStartChapter, batchChapterCount, accumulatedChapters);

        // 更新累积的章节数据
        accumulatedChapters = { ...batchResult };

        // 【关键】更新本地跟踪变量，而不是依赖异步状态
        const batchSize = batchEndChapter - batchStartChapter + 1;
        totalGeneratedSoFar += batchSize;

        // 更新累积的章节数据（这里需要等待实际的章节生成完成后再更新，暂时保持现状）

        console.log(`第${currentBatch}批完成，累计生成 ${totalGeneratedSoFar}/${totalChapters} 章`);

        // 继续下一批
        currentBatch++;
      }

      // 全部完成
      setFullCycleProgress({
        current: totalChapters,
        total: totalChapters,
        currentBatch: totalBatches,
        totalBatches,
        message: '所有章节生成完成！'
      });

      // 延迟显示完成消息
      setTimeout(() => {
        alert(`全流程自动化生成完成！共生成 ${totalChapters} 个章节内容。整个小说创作流程已结束。`);
        setIsFullCycleGenerating(false);
        setFullCycleProgress(null);

        // 结束整个自动化流程
        if (setIsAutoFlowRunning) setIsAutoFlowRunning(false);
        if (setAutoFlowStep) setAutoFlowStep('全流程自动化生成完成！');
      }, 1000);

    } catch (error) {
      console.error('一键循环生成失败:', error);
      alert('生成过程中出现错误，请稍后重试');
      setIsFullCycleGenerating(false);
      setFullCycleProgress(null);
    }
  };

  // 模拟批量生成的函数 - 支持可变数量的章节生成
  // 【关键修复】添加expectedStartChapter和expectedChapterCount参数，避免依赖异步状态
  const simulateBatchGeneration = async (expectedStartChapter?: number, expectedChapterCount?: number, allGeneratedChapters?: {[key: number]: string}): Promise<{[key: number]: string}> => {
    return new Promise(async (resolve, reject) => {
      try {
        // 检查项目和微故事
        if (!currentProject) {
          reject(new Error('未找到当前项目'));
          return;
        }

        const microStoriesToUse = currentProject.selectedMicroStories || currentProject.savedMicroStories;

        if (!microStoriesToUse || microStoriesToUse.length < 4) {
          reject(new Error('需要至少保存4个小故事才能进行批量生成'));
          return;
        }

          console.log(`模拟用户：点击批量生成${expectedChapterCount || 8}章按钮`);
        setIsBatchGenerating(true);

        try {
          // 【关键修复】优先使用传入的参数，避免依赖异步状态
          const startChapter = expectedStartChapter || 1;
          const chapterCount = expectedChapterCount || 8;

          const generationContext = buildGenerationContext(startChapter);
          console.log('批量生成上下文长度:', generationContext.length);


          console.log(`模拟用户：开始流式生成${chapterCount}章内容...`);

          // 初始化生成状态
          setGenerationState({
            isGenerating: true,
            currentGeneratingChapter: startChapter,
            totalChapters: chapterCount,
            completedChapters: []
          });

          // 先准备流式请求，获取requestId
          // 【关键修复】不传递generatedChapters，避免后端依赖历史数据重新计算起始点
          const prepareResponse = await blueprintApi.prepareChapterStream({
            context: generationContext,
            chapterNumber: startChapter,
            previousEnding: previousChapterEnding || undefined,
            savedMicroStories: microStoriesToUse,
            generatedChapters: undefined // 总是传递undefined，让后端完全依赖chapterNumber参数
          });

          const requestId = prepareResponse.requestId;
          setCurrentRequestId(requestId);
          console.log('模拟用户：获取到requestId:', requestId);

          // 使用SSE进行流式生成
          const eventSource = blueprintApi.generateChapterStream(requestId);
          setCurrentEventSource(eventSource);

          let generatedChaptersData: {[key: number]: string} = {};

          // 设置SSE消息处理器
          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('模拟用户：收到SSE消息:', data.type, data.chapter || '');

              switch (data.type) {
                case 'start':
                  console.log('模拟用户：开始生成');
                  setGenerationState(prev => ({
                    ...prev,
                    isGenerating: true,
                    totalChapters: 8
                  }));
                  break;

                case 'story_start':
                  console.log('模拟用户：开始生成小故事');
                  setGenerationState(prev => ({
                    ...prev,
                    currentGeneratingChapter: data.chapters[0]
                  }));
                  setCurrentChapter(data.chapters[0]);
                  setGeneratedContent('');
                  break;

                case 'story_chunk':
                  if (data.content) {
                    const cleanContent = cleanWriterContent(data.content);
                    setGeneratedContent(cleanContent);
                    console.log(`模拟用户：实时更新内容，当前长度: ${cleanContent.length}`);
                  }
                  break;

                case 'chapter_complete':
                  if (data.content) {
                    const cleanContent = cleanWriterContent(data.content);
                    generatedChaptersData[data.chapter] = cleanContent;

                    setGeneratedChapters(prev => ({ ...prev, [data.chapter]: cleanContent }));

                    setGenerationState(prev => ({
                      ...prev,
                      completedChapters: [...prev.completedChapters, data.chapter],
                      currentGeneratingChapter: data.chapter + 1 <= prev.totalChapters ? data.chapter + 1 : null
                    }));

                    if (data.chapter === currentChapter) {
                      setGeneratedContent(cleanContent);
                    }

                    console.log(`模拟用户：第${data.chapter}章生成完成，字数: ${getWordCount(cleanContent)}`);
                  }
                  break;

                case 'story_complete':
                  console.log('模拟用户：小故事生成完成');
                  break;

                case 'cancelled':
                  console.log('模拟用户：生成被取消');
                  setGenerationState({
                    isGenerating: false,
                    currentGeneratingChapter: null,
                    totalChapters: 0,
                    completedChapters: []
                  });
                  eventSource.close();
                  setCurrentEventSource(null);
                  setIsBatchGenerating(false);
                  reject(new Error('生成已被终止'));
                  break;

                case 'story_error':
                  console.error('模拟用户：生成出错:', data.error);
                  break;

                case 'complete':
                  console.log('模拟用户：批量生成完成');

                  try {
                    // 更新previousChapterEnding
                    const chapterKeys = Object.keys(generatedChaptersData).map(Number).sort((a, b) => a - b);
                    if (chapterKeys.length > 0) {
                      const lastChapterNum = Math.max(...chapterKeys);
                      const lastChapterContent = generatedChaptersData[lastChapterNum];
                      if (lastChapterContent) {
                        const lines = lastChapterContent.split('\n');
                        const lastLines = lines.slice(-10).join('\n');
                        setPreviousChapterEnding(lastLines);
                      }
                    }

                    // 合并新生成的章节到总章节中
                    // 【修复】使用传入的参数或当前状态，确保累积保存包含所有历史章节
                    const allExistingChapters = allGeneratedChapters || generatedChapters;
                    const updatedChapters = { ...allExistingChapters, ...generatedChaptersData };
                    setGeneratedChapters(updatedChapters);

                    // 重置生成状态
                    const totalGenerated = Object.keys(updatedChapters).length;
                    setGenerationState({
                      isGenerating: false,
                      currentGeneratingChapter: null,
                      totalChapters: 0,
                      completedChapters: []
                    });

                    console.log(`模拟用户：批量生成完成！共生成了${totalGenerated}个章节的内容`);

                    // 自动执行保存和下载（完全自动化，无需用户确认）
                    console.log('模拟用户：自动保存内容，包含所有历史章节');
                    simulateSaveContent(updatedChapters);

                    console.log('模拟用户：自动下载TXT文件');
                    simulateDownloadTXT(updatedChapters);

                    console.log('模拟用户：完成本批次的保存和下载，准备继续下一批');

                    eventSource.close();
                    setCurrentEventSource(null);
                    setIsBatchGenerating(false);

                    // 完成这一批次的生成，返回新生成的章节数据
                    resolve(updatedChapters);

                  } catch (error) {
                    console.error('模拟用户：处理完成事件时出现错误:', error);
                    setGenerationState({
                      isGenerating: false,
                      currentGeneratingChapter: null,
                      totalChapters: 0,
                      completedChapters: []
                    });
                    setIsBatchGenerating(false);
                    reject(error);
                  }
                  break;
              }
            } catch (error) {
              console.error('模拟用户：解析SSE消息失败:', error);
              reject(error);
            }
          };

          eventSource.onerror = (error) => {
            console.error('模拟用户：SSE连接错误:', error);
            setIsBatchGenerating(false);
            reject(error);
          };

        } catch (error) {
          console.error('模拟用户：批量生成失败:', error);
          setIsBatchGenerating(false);
          reject(error);
        }

      } catch (error) {
        reject(error);
      }
    });
  };

  // 模拟保存内容的函数
  const simulateSaveContent = async (chaptersToSave?: {[key: number]: string}): Promise<void> => {
    return new Promise((resolve) => {
      try {
        const chapters = chaptersToSave || generatedChapters;
        if (Object.keys(chapters).length === 0) {
          console.log('模拟用户：没有内容可保存');
          resolve();
          return;
        }

        // 创建保存版本
        const saveVersion = {
          id: `auto_save_${Date.now()}`,
          timestamp: new Date().toISOString(),
          chapterCount: Object.keys(chapters).length,
          totalWords: Object.values(chapters).reduce((sum, content) => sum + getWordCount(content), 0),
          chapters: { ...chapters },
          preview: Object.values(chapters)[0]?.substring(0, 200) + '...' || ''
        };

        // 获取现有保存版本
        const existingVersions = currentProject?.savedVersions || [];

        // 保存到项目中
        if (currentProject) {
          updateProject(currentProject.id, {
            generatedChapters: { ...chapters },
            savedVersions: [saveVersion, ...existingVersions].slice(0, 10) // 保留最近10个版本
          });
        }

        console.log('模拟用户：内容已自动保存');
        resolve();
      } catch (error) {
        console.error('模拟用户：自动保存失败:', error);
        resolve(); // 即使保存失败也继续
      }
    });
  };

  // 模拟下载TXT的函数
  const simulateDownloadTXT = async (chaptersToDownload?: {[key: number]: string}): Promise<void> => {
    return new Promise((resolve) => {
      try {
        const chapters = chaptersToDownload || generatedChapters;
        if (Object.keys(chapters).length === 0) {
          console.log('模拟用户：没有内容可下载');
          resolve();
          return;
        }

        // 将所有生成的章节合并成一个文档
        const allChapters = Object.keys(chapters)
          .map(Number)
          .sort((a, b) => a - b)
          .map(chapterNum => chapters[chapterNum])
          .join('\n\n');

        const projectTitle = currentProject?.bookName || '小说正文';
        const exportContent = `${projectTitle}\n\n${allChapters}`;

        // 创建下载
        const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('模拟用户：TXT文件已自动下载');
        resolve();
      } catch (error) {
        console.error('模拟用户：自动下载失败:', error);
        resolve(); // 即使下载失败也继续
      }
    });
  };

  const buildGenerationContext = (currentBatchStartChapter?: number): string => {
    if (!currentProject) return '';

    let context = `=== ${currentProject.bookName} - 完整故事架构背景 ===\n\n`;

    // 项目大纲 - 完整信息
    if (currentProject.outline) {
      context += '【项目大纲】\n';
      context += `书名：${currentProject.bookName}\n`;
      context += `核心概念：${currentProject.outline.logline}\n`;
      context += `人物关系：${currentProject.outline.characters}\n`;
      context += `世界观设定：${currentProject.outline.world}\n`;
      context += `主要冲突：${currentProject.outline.hook}\n`;
      context += `金手指设定：${currentProject.outline.themes}\n\n`;
    }

    // 世界观设定 - 精简关键信息
    if (currentProject.worldSetting) {
      context += '【世界观设定】\n';
      // 只保留前1000字符的关键信息
      const worldSettingSummary = currentProject.worldSetting.substring(0, 1000);
      context += worldSettingSummary + (currentProject.worldSetting.length > 1000 ? '...' : '') + '\n\n';
    }

    // 人物设定 - 精简关键信息
    if (currentProject.characters) {
      context += '【人物设定】\n';
      // 只保留前800字符的关键信息
      const charactersSummary = currentProject.characters.substring(0, 800);
      context += charactersSummary + (currentProject.characters.length > 800 ? '...' : '') + '\n\n';
    }

    // 详细情节细纲 - 精简到相关部分
    if (currentProject.detailedOutline) {
      context += '【情节架构】\n';
      // 只保留前600字符的架构概述
      const outlineSummary = currentProject.detailedOutline.substring(0, 600);
      context += outlineSummary + (currentProject.detailedOutline.length > 600 ? '...' : '') + '\n\n';
    }

    // 当前相关的4个小故事细纲 - 只包含即将生成的内容相关信息
    if (currentProject.savedMicroStories && currentProject.savedMicroStories.length > 0) {
      // 【关键修复】使用传入的参数而不是依赖异步状态
      const startChapter = currentBatchStartChapter || 1;
      const batchIndex = Math.floor((startChapter - 1) / 8); // 计算批次索引（0, 1, 2...）
      const startStoryIndex = batchIndex * 4; // 每批4个小故事（对应8章）
      const relevantStories = currentProject.savedMicroStories.slice(startStoryIndex, startStoryIndex + 4);

      if (relevantStories.length > 0) {
        context += '【本批次小故事细纲】\n';
        relevantStories.forEach((story, index) => {
          const globalIndex = startStoryIndex + index;
          const chapterOffset = globalIndex * 2;
          context += `小故事${globalIndex + 1}（第${chapterOffset + 1}-${chapterOffset + 2}章）：\n`;
          context += `标题：${story.title}\n`;
          context += `内容：${story.content}\n\n`;
        });
      }
    }

    // 特别强调当前章节对应的小故事
    if (currentProject.savedMicroStories && currentProject.savedMicroStories.length > 0) {
      const currentStoryIndex = Math.floor((currentChapter - 1) / 2); // 计算当前章节对应的小故事索引
      const currentStory = currentProject.savedMicroStories[currentStoryIndex];

      if (currentStory) {
        context += `【当前章节核心小故事】\n`;
        context += `章节：第${currentChapter}～${currentChapter + 1}章\n`;
        context += `对应小故事：${currentStory.title}\n`;
        context += `小故事详细内容：${currentStory.content}\n`;
        context += `所属中故事：${currentStory.macroStoryTitle}\n\n`;
        context += `重要提示：请严格按照上述小故事内容进行创作，确保章节内容与小故事情节完全吻合。\n\n`;
      }
    }

    return context;
  };

  const navigateChapter = (direction: 'prev' | 'next') => {
    const availableChapters = Object.keys(generatedChapters).map(Number).sort((a, b) => a - b);

    if (direction === 'prev') {
      // 向前切换到上一组章节（每2章为一组）
      const currentGroupStart = Math.floor((currentChapter - 1) / 2) * 2 + 1;
      const prevGroupStart = currentGroupStart - 2;

      if (prevGroupStart >= 1) {
        setCurrentChapter(prevGroupStart);
        setGeneratedContent(generatedChapters[prevGroupStart] || '');
        setJumpToChapter(prevGroupStart.toString());
      }
    } else if (direction === 'next') {
      // 向后切换到下一组章节（每2章为一组）
      const currentGroupStart = Math.floor((currentChapter - 1) / 2) * 2 + 1;
      const nextGroupStart = currentGroupStart + 2;

      if (availableChapters.includes(nextGroupStart)) {
        setCurrentChapter(nextGroupStart);
        setGeneratedContent(generatedChapters[nextGroupStart] || '');
        setJumpToChapter(nextGroupStart.toString());

        // 如果下一章正在生成中，实时内容会通过SSE更新
        if (generationState.currentGeneratingChapter === nextGroupStart) {
          // 内容会通过SSE实时更新，不需要手动设置
        }
      }
    }
  };

  const saveChapter = () => {
    // 保存章节内容到本地存储或导出
    alert('保存功能开发中...');
  };

  const exportChapter = () => {
    // 导出章节内容
    const data = `第${currentChapter}章\n\n${generatedContent}`;
    const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chapter_${currentChapter}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-secondary-900 mb-2">未找到项目数据</h2>
          <p className="text-secondary-600 mb-4">请先创建项目并完成前期准备</p>
          <button
            onClick={onBack}
            className="btn btn-primary"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      {/* Header - 重新设计的紧凑布局 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="w-full px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：返回和标题 */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              <button
                onClick={onBack}
                disabled={generationState.isGenerating}
                className={`p-2 rounded-lg transition-colors ${
                  generationState.isGenerating
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-secondary-100 hover:bg-secondary-200 text-secondary-600'
                }`}
                title={generationState.isGenerating ? '生成过程中无法返回，请等待完成或终止生成' : '返回上一页'}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-blue-100 rounded-lg">
                  <PenTool className="w-4 h-4 text-blue-600" />
                </div>
                <div className="hidden sm:block">
                  <h1 className="text-base font-bold text-secondary-900">正文写作工作室</h1>
                  <p className="text-xs text-secondary-600">基于完整故事架构进行创作</p>
                </div>
                <div className="sm:hidden">
                  <h1 className="text-sm font-bold text-secondary-900">写作工作室</h1>
                </div>
              </div>
            </div>

            {/* 中间：章节状态和导航 */}
            <div className="flex items-center space-x-6 flex-1 justify-center min-w-0">
              {/* 章节状态显示 */}
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 px-3 py-1.5 bg-white/70 rounded-lg border border-secondary-200">
                  <BookOpen className="w-4 h-4 text-primary-600" />
                  <div className="text-sm font-medium text-secondary-800">
                    {generationState.isGenerating ? (
                      <>
                        <span>{getChapterRangeDisplay(generationState.currentGeneratingChapter || 1)}</span>
                        <span className="ml-2 text-orange-600 font-bold">
                          {generatedContent ? getWordCount(generatedContent) : 0}字
                        </span>
                        <div className="flex items-center ml-2">
                          <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                          <span className="ml-1 text-xs text-orange-600 font-medium">生成中</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <span>{getChapterRangeDisplay(currentChapter)}</span>
                        {generatedContent && (
                          <span className="ml-2 text-blue-600 font-bold">
                            {getWordCount(generatedContent)}字
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* 已生成统计 */}
                <div className="flex items-center space-x-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-xs font-medium text-blue-700">
                    {Object.keys(generatedChapters).length} 章已生成
                  </span>
                </div>
              </div>

              {/* 章节导航 - 美化版 */}
              <div className="flex items-center space-x-2 bg-white/80 rounded-xl px-4 py-2 border border-secondary-200 shadow-sm">
                <button
                  onClick={() => navigateChapter('prev')}
                  disabled={Object.keys(generatedChapters).length === 0 || (() => {
                    const currentGroupStart = Math.floor((currentChapter - 1) / 2) * 2 + 1;
                    const prevGroupStart = currentGroupStart - 2;
                    return prevGroupStart < 1;
                  })()}
                  className="flex items-center justify-center w-8 h-8 bg-secondary-100 hover:bg-secondary-200 disabled:bg-gray-100 disabled:text-gray-400 rounded-lg transition-all duration-200 disabled:cursor-not-allowed hover:shadow-sm"
                  title="上一组章节"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* 章节跳转 */}
                <div className="flex items-center space-x-2 px-3 py-1 bg-secondary-50 rounded-lg">
                  <span className="text-xs font-medium text-secondary-600">跳转到</span>
                  <div className="flex items-center space-x-1">
                    <span className="text-xs text-secondary-500">第</span>
                    <input
                      type="number"
                      min="1"
                      value={jumpToChapter}
                      onChange={(e) => setJumpToChapter(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && jumpToChapterGroup()}
                      placeholder="7"
                      className="w-12 px-2 py-1 text-sm border border-secondary-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-center"
                    />
                    <span className="text-xs text-secondary-500">章</span>
                  </div>
                  <button
                    onClick={jumpToChapterGroup}
                    className="px-3 py-1 bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium rounded-lg transition-colors hover:shadow-sm"
                  >
                    跳转
                  </button>
                </div>

                <button
                  onClick={() => navigateChapter('next')}
                  disabled={Object.keys(generatedChapters).length === 0 || (() => {
                    const availableChapters = Object.keys(generatedChapters).map(Number).sort((a, b) => a - b);
                    const currentGroupStart = Math.floor((currentChapter - 1) / 2) * 2 + 1;
                    const nextGroupStart = currentGroupStart + 2;
                    return !availableChapters.includes(nextGroupStart);
                  })()}
                  className="flex items-center justify-center w-8 h-8 bg-secondary-100 hover:bg-secondary-200 disabled:bg-gray-100 disabled:text-gray-400 rounded-lg transition-all duration-200 disabled:cursor-not-allowed hover:shadow-sm"
                  title="下一组章节"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 右侧：操作按钮面板 */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              {/* 生成控制按钮 */}
              <div className="flex flex-col space-y-2">
                {generationState.isGenerating && (
                  <button
                    onClick={stopGeneration}
                    className="flex items-center space-x-2 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-sm"
                  >
                    <span className="hidden sm:inline">终止生成</span>
                    <span className="sm:hidden">终止</span>
                  </button>
                )}
                {!generationState.isGenerating && Object.keys(generatedChapters).length > 0 && (
                  <button
                    onClick={resetGeneration}
                    className="flex items-center space-x-2 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors text-sm"
                  >
                    <span className="hidden sm:inline">重置状态</span>
                    <span className="sm:hidden">重置</span>
                  </button>
                )}
              </div>

              {/* 文件操作按钮 - 双排网格布局 */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={saveGeneratedContent}
                  disabled={Object.keys(generatedChapters).length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Save className="w-4 h-4" />
                  <span className="hidden sm:inline">保存</span>
                </button>

                <button
                  onClick={() => setShowSavedVersions(true)}
                  disabled={!currentProject?.savedVersions || currentProject.savedVersions.length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Eye className="w-4 h-4" />
                  <span className="hidden sm:inline">历史</span>
                </button>

                <button
                  onClick={exportGeneratedContent}
                  disabled={Object.keys(generatedChapters).length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">TXT</span>
                </button>

                <button
                  onClick={exportAsDocx}
                  disabled={Object.keys(generatedChapters).length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">DOCX</span>
                </button>
              </div>

              {/* AI提示 */}
              <div className="flex items-center space-x-2 text-secondary-600">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs hidden lg:inline">AI 辅助写作</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* 控制面板 */}
          <div className="lg:col-span-3 space-y-6">
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-secondary-900 mb-4 flex items-center">
                <BookOpen className="w-5 h-5 mr-2 text-primary-600" />
                写作控制
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-secondary-700 mb-2">
                    当前章节
                  </label>
                  <div className="text-2xl font-bold text-primary-600">
                    {getChapterRangeDisplay(currentChapter)}
                  </div>
                  <div className="text-sm text-secondary-500 mt-1">
                    已生成: {Object.keys(generatedChapters).length} 章
                    {generationState.isGenerating && (
                      <span className="ml-2 text-orange-600">
                        (第{generationState.currentGeneratingChapter}章进行中...)
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {/* 检查是否有已生成的章节，如果有则显示手动选择模式 */}
                  {Object.keys(generatedChapters).length > 0 ? (
                    <div className="space-y-3">
                      <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center space-x-2 mb-2">
                          <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                          <span className="text-sm font-medium text-amber-800">检测到已有正文内容</span>
                        </div>
                        <p className="text-sm text-amber-700 mb-3">
                          已生成 {Object.keys(generatedChapters).length} 章内容，可以选择继续生成或重新生成之前的章节
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => {
                              const nextChapter = getNextChapterToGenerate();
                              setSelectedStartChapter(nextChapter);
                              setIsRegenerateMode(false);
                              setShowChapterSelector(true);
                            }}
                            className="flex items-center justify-center space-x-2 px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-medium transition-all duration-200 text-sm"
                          >
                            <PenTool className="w-4 h-4" />
                            <span>继续生成</span>
                          </button>
                          <button
                            onClick={() => {
                              setSelectedStartChapter(1); // 默认从第一章开始重新生成
                              setIsRegenerateMode(true);
                              setShowChapterSelector(true);
                            }}
                            className="flex items-center justify-center space-x-2 px-3 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white rounded-lg font-medium transition-all duration-200 text-sm"
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span>重新生成</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-center text-sm text-secondary-500">或继续批量生成</div>
                    </div>
                  ) : null}

                  <button
                    onClick={() => generateBatchContent()}
                    disabled={isBatchGenerating || isGenerating || isFullCycleGenerating || (() => {
                      const generatedCount = Object.keys(generatedChapters).length;
                      const batchIndex = Math.floor(generatedCount / 8); // 当前是第几批
                      const requiredStories = (batchIndex + 1) * 4; // 需要的微故事数量
                      return (currentProject?.savedMicroStories?.length || 0) < requiredStories;
                    })()}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-semibold transition-all duration-200 disabled:cursor-not-allowed"
                  >
                    {isBatchGenerating ? (
                      <>
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        <span>批量生成中...</span>
                      </>
                    ) : (
                      <>
                        <PenTool className="w-6 h-6" />
                        <span>
                          {(() => {
                            const generatedCount = Object.keys(generatedChapters).length;
                            if (generatedCount === 0) return '批量生成8章';
                            if (generatedCount % 8 !== 0) return `继续生成 (${generatedCount % 8}/8)`;
                            return '继续生成下一批';
                          })()}
                        </span>
                      </>
                    )}
                  </button>

                  <div className="text-center text-sm text-secondary-500">或</div>

                  <button
                    onClick={generateFullCycleContent}
                    disabled={isGenerating || isBatchGenerating || isFullCycleGenerating || !currentProject?.savedMicroStories?.length}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-semibold transition-all duration-200 disabled:cursor-not-allowed"
                  >
                    {isFullCycleGenerating ? (
                      <>
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        <span>循环生成中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6" />
                        <span>
                          {currentProject?.savedMicroStories?.length
                            ? `一键循环生成 (${currentProject.savedMicroStories.length}个小故事 → ${currentProject.savedMicroStories.length * 2}章)`
                            : '一键循环生成'}
                        </span>
                      </>
                    )}
                  </button>

                  {/* 一键循环生成进度显示 */}
                  {fullCycleProgress && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-green-700">
                            {fullCycleProgress.currentBatch}/{fullCycleProgress.totalBatches} 批次
                          </span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-sm text-green-600">
                            {fullCycleProgress.current}/{fullCycleProgress.total} 章
                          </span>
                          {fullCycleProgress.currentChapter && (
                            <div className="flex items-center space-x-2 px-2 py-1 bg-green-100 rounded-md">
                              <span className="text-xs font-medium text-green-800">
                                第{fullCycleProgress.currentChapter}章
                              </span>
                              {fullCycleProgress.currentChapterWords !== undefined && (
                                <span className="text-xs text-green-600">
                                  ({fullCycleProgress.currentChapterWords}字)
                                </span>
                              )}
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="w-full bg-green-200 rounded-full h-2 mb-2">
                        <div
                          className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${(fullCycleProgress.current / fullCycleProgress.total) * 100}%` }}
                        ></div>
                      </div>

                      <div className="text-sm text-green-700 text-center">
                        {fullCycleProgress.message}
                      </div>

                      <div className="mt-2 text-xs text-green-600 text-center">
                        每生成8章自动保存历史快照 • 共需保存 {fullCycleProgress.totalBatches} 个快照
                      </div>
                    </div>
                  )}

                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={saveChapter}
                    disabled={!generatedContent}
                    className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm rounded font-medium disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    <span>保存</span>
                  </button>
                  <button
                    onClick={exportChapter}
                    disabled={!generatedContent}
                    className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded font-medium disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    <span>导出</span>
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* 内容展示区域 */}
          <div className="lg:col-span-6">
            {generatedContent ? (
              <div className="card p-8 bg-white/95 backdrop-blur-sm shadow-xl border-0">
                <div className="mb-6 pb-4 border-b border-secondary-200">
                  <h2 className="text-2xl font-bold text-secondary-900 mb-2">
                    {getChapterRangeDisplay(currentChapter)}
                  </h2>
                </div>
                <div className="prose prose-base max-w-none">
                  <div
                    className="text-secondary-800 leading-relaxed text-base font-serif"
                    style={{
                      lineHeight: '1.8',
                      fontFamily: '"Noto Serif SC", "Source Han Serif SC", "宋体", serif',
                      fontSize: '16px',
                      letterSpacing: '0.3px',
                      whiteSpace: 'pre-wrap', // 保持换行格式
                    }}
                  >
                    {/* 处理首行缩进和段落格式 */}
                    {generatedContent.split('\n\n').map((paragraph, index) => {
                      // 检查是否是标题行
                      const isTitleLine = paragraph.match(/^第\d+章\s*\[/);
                      const isEmptyLine = paragraph.trim() === '';

                      if (isEmptyLine) return null;

                      return (
                        <p
                          key={index}
                          className="mb-4"
                          style={{
                            textIndent: isTitleLine ? '0' : '2em', // 标题不缩进，正文缩进
                            marginBottom: '1.2em',
                            textAlign: 'justify', // 两端对齐
                          }}
                        >
                          {paragraph.trim()}
                        </p>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="card p-12 text-center">
                <PenTool className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-secondary-900 mb-2">
                  准备开始写作
                </h3>
                <p className="text-secondary-600 mb-6">
                  点击"生成章节内容"按钮，AI将基于完整的故事架构为你创作精彩的章节内容
                </p>
                <div className="text-sm text-secondary-500">
                  💡 AI会自动整合项目大纲、世界观、人设、中故事等所有背景信息
                </div>
              </div>
            )}
          </div>

          {/* 小故事对照面板 */}
          <div className="lg:col-span-3">
            <div className="sticky top-8 space-y-6">
              {/* 当前章节对应的小故事 */}
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-secondary-900 mb-4 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-primary-600" />
                  章节对照
                </h3>

                {(() => {
                  // 计算当前章节对应的小故事索引
                  const chapterIndex = Math.floor((currentChapter - 1) / 2); // 每2章对应一个小故事
                  const currentMicroStory = currentProject?.savedMicroStories?.[chapterIndex];

                  if (currentMicroStory) {
                    return (
                      <div className="space-y-4">
                        <div className="bg-primary-50 p-3 rounded-lg">
                          <h4 className="font-medium text-primary-900 mb-2">
                            第{chapterIndex + 1}个小故事
                          </h4>
                          <p className="text-sm text-primary-800 font-medium mb-2">
                            {currentMicroStory.title}
                          </p>
                          <div className="text-xs text-primary-700 bg-white p-3 rounded border-l-2 border-primary-500 max-h-40 overflow-y-auto">
                            {currentMicroStory.content}
                          </div>
                        </div>

                        <div className="text-xs text-secondary-500 space-y-1">
                          <p>• 对应章节：第{currentChapter}～{currentChapter + 1}章</p>
                          <p>• 中故事：{currentMicroStory.macroStoryTitle}</p>
                          <p>• 顺序：第{currentMicroStory.order + 1}个小故事</p>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-center py-8 text-secondary-500">
                        <FileText className="w-12 h-12 mx-auto mb-3 text-secondary-300" />
                        <p className="text-sm">未找到对应的小故事</p>
                        <p className="text-xs mt-1">
                          请确保已在情节结构细化界面生成小故事
                        </p>
                      </div>
                    );
                  }
                })()}
              </div>

              {/* 写作提示 */}
              <div className="card p-6">
                <h4 className="text-md font-semibold text-secondary-900 mb-3">写作提示</h4>
                <div className="text-sm text-secondary-600 space-y-2">
                  <p>• 每章2000-2200字</p>
                  <p>• 包含吸引人的章节标题</p>
                  <p>• 融入完整的故事背景</p>
                  <p>• 保持连贯的阅读体验</p>
                  {previousChapterEnding && (
                    <div>
                      <p className="font-medium text-secondary-900 mt-3 mb-1">衔接参考：</p>
                      <p className="text-xs bg-secondary-50 p-2 rounded">
                        {previousChapterEnding.substring(0, 100)}...
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 章节选择器模态框 */}
      {showChapterSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {isRegenerateMode ? '选择重新生成起始章节' : '选择继续生成起始章节'}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {isRegenerateMode
                      ? '从选中的章节开始重新生成，将覆盖现有内容'
                      : '从选中的章节开始生成后续所有未生成的内容'
                    }
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowChapterSelector(false);
                    setIsRegenerateMode(false);
                    setSelectedStartChapter(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <span className="text-2xl">&times;</span>
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {currentProject?.savedMicroStories && currentProject.savedMicroStories.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentProject.savedMicroStories.map((story, storyIndex) => {
                      const chapterStart = storyIndex * 2 + 1;
                      const chapterEnd = storyIndex * 2 + 2;
                      const isGenerated = generatedChapters[chapterStart] && generatedChapters[chapterEnd];
                      const isPartiallyGenerated = generatedChapters[chapterStart] || generatedChapters[chapterEnd];
                      const isSelected = selectedStartChapter === chapterStart;
                      const canSelect = isRegenerateMode || !isGenerated; // 重新生成模式下都可以选择，继续生成模式下只有未完成的才能选择

                      return (
                        <div
                          key={storyIndex}
                          className={`border rounded-lg p-4 transition-all cursor-pointer ${
                            !canSelect
                              ? 'border-gray-200 bg-gray-50 opacity-60'
                              : isGenerated && isRegenerateMode
                              ? 'border-red-200 bg-red-50 hover:bg-red-100'
                              : isGenerated
                              ? 'border-green-200 bg-green-50'
                              : isPartiallyGenerated
                              ? 'border-yellow-200 bg-yellow-50'
                              : isSelected
                              ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-200'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                          onClick={() => {
                            if (canSelect) {
                              setSelectedStartChapter(chapterStart);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 mb-1">
                                第{storyIndex + 1}个小故事
                              </h4>
                              <p className="text-sm text-gray-600 mb-2 line-clamp-1">
                                {story.title}
                              </p>
                              <div className="flex items-center space-x-2 text-xs text-gray-500">
                                <span>第{chapterStart}～{chapterEnd}章</span>
                                <span>•</span>
                                <span>{story.macroStoryTitle}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end space-y-1">
                              {isGenerated ? (
                                <div className="flex items-center space-x-1 text-green-600">
                                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  <span className="text-xs font-medium">已完成</span>
                                </div>
                              ) : isPartiallyGenerated ? (
                                <div className="flex items-center space-x-1 text-yellow-600">
                                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                                  <span className="text-xs font-medium">部分完成</span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1 text-gray-400">
                                  <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                                  <span className="text-xs">未生成</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded max-h-16 overflow-hidden">
                            {story.content.substring(0, 80)}...
                          </div>

                          {canSelect && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedStartChapter(chapterStart);
                                setShowChapterSelector(false);
                                setIsRegenerateMode(false);
                                generateFromChapter(chapterStart, isRegenerateMode);
                              }}
                              className={`mt-3 w-full px-3 py-2 text-sm font-medium rounded transition-colors ${
                                isSelected
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : isRegenerateMode && isGenerated
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              }`}
                            >
                              {isRegenerateMode && isGenerated
                                ? `从第${chapterStart}章重新生成`
                                : `从第${chapterStart}章开始生成`
                              }
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {selectedStartChapter && (
                    <div className={`mt-6 p-4 border rounded-lg ${
                      isRegenerateMode ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-sm font-medium ${
                            isRegenerateMode ? 'text-red-900' : 'text-blue-900'
                          }`}>
                            已选择：从第{selectedStartChapter}章{isRegenerateMode ? '重新' : ''}开始生成
                          </p>
                          <p className={`text-xs mt-1 ${
                            isRegenerateMode ? 'text-red-700' : 'text-blue-700'
                          }`}>
                            {isRegenerateMode
                              ? `将重新生成从第${selectedStartChapter}章到最后的全部内容（覆盖现有内容）`
                              : `将生成从第${selectedStartChapter}章到最后的全部内容`
                            }
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setShowChapterSelector(false);
                            setIsRegenerateMode(false);
                            generateFromChapter(selectedStartChapter, isRegenerateMode);
                          }}
                          className={`px-4 py-2 text-white text-sm font-medium rounded hover:opacity-90 transition-colors ${
                            isRegenerateMode ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                        >
                          确认{isRegenerateMode ? '重新' : ''}开始生成
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>未找到小故事数据</p>
                  <p className="text-sm mt-1">请先在情节结构细化页面生成小故事</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 版本历史模态框 */}
      {showSavedVersions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">保存的版本历史</h3>
                <button
                  onClick={() => setShowSavedVersions(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <span className="text-2xl">&times;</span>
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {currentProject?.savedVersions && currentProject.savedVersions.length > 0 ? (
                <div className="space-y-4">
                  {currentProject.savedVersions.map((version) => (
                    <div key={version.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <BookOpen className="w-6 h-6 text-blue-600" />
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900">
                              {version.chapterCount}章 • {version.totalWords}字
                            </h4>
                            <p className="text-sm text-gray-500">
                              {new Date(version.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => restoreSavedVersion(version.id)}
                          className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
                        >
                          恢复此版本
                        </button>
                      </div>
                      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                        <p className="line-clamp-2">{version.preview}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>暂无保存的版本历史</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}