// React import not needed with jsx: "react-jsx"
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, BookOpen, Sparkles, FileText, PenTool, RefreshCw, Save, Download, ChevronLeft, ChevronRight, Eye, Trash2 } from 'lucide-react';
import { getMacroStoryIndexFromId, SavedMicroStory, sortSavedMicroStoriesForChapters, useWorldSettings } from '../contexts/WorldSettingsContext';
import { blueprintApi } from '../services/api';
import { DEFAULT_WRITER_MODEL_VALUE, getWriterModelOption, toWriterModelRequest, WRITER_MODEL_OPTIONS } from '../utils/llmModelSelection';

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
  let cleanedContent = String(content || '')
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

function normalizeTargetEpisodeWords(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 800;
  return Math.min(5000, Math.max(500, Math.round(numericValue)));
}

function normalizeTargetNovelWords(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 2100;
  return Math.min(5000, Math.max(800, Math.round(numericValue)));
}

function extractChapterEnding(content: string, linesCount: number = 10): string {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l !== undefined);
  return lines.slice(-linesCount).join('\n');
}

function computePreviousEndingFromChapters(
  chapters: { [key: number]: string },
  beforeChapter: number
): string {
  const keys = Object.keys(chapters).map(Number).filter(n => Number.isFinite(n) && n < beforeChapter);
  if (keys.length === 0) return '';
  const last = Math.max(...keys);
  return extractChapterEnding(chapters[last] || '');
}

function extractChapterOpening(content: string, linesCount: number = 8): string {
  if (!content) return '';
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return lines.slice(0, linesCount).join('\n');
}

function getSavedMicroStoryChapterNumber(story: SavedMicroStory | undefined, fallback: number): number {
  const text = `${story?.title || ''}\n${story?.content || ''}`;
  if (/小节/.test(text)) return fallback;
  const matches = [...text.matchAll(/第\s*(\d{1,4})\s*[章节集]/g)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value > 0);
  return matches[0] || fallback;
}

function getFallbackChapterNumberForStory(story: SavedMicroStory | undefined, index: number): number {
  if (!story) return index + 1;
  if (/小节/.test(`${story.title || ''}\n${story.content || ''}`)) return index + 1;
  const macroIndex = getMacroStoryIndexFromId(story.macroStoryId);
  const order = Number(story.order);
  if (Number.isFinite(macroIndex) && macroIndex < Number.MAX_SAFE_INTEGER && Number.isFinite(order) && order >= 0) {
    return macroIndex * 15 + order + 1;
  }
  return index + 1;
}

function buildChapterStoryEntries(stories: SavedMicroStory[] | undefined): Array<{
  story: SavedMicroStory;
  chapterNumber: number;
  originalIndex: number;
}> {
  return (stories || [])
    .map((story, index) => ({
      story,
      chapterNumber: getSavedMicroStoryChapterNumber(story, getFallbackChapterNumberForStory(story, index)),
      originalIndex: index,
    }))
    .sort((a, b) => (
      a.chapterNumber - b.chapterNumber ||
      a.originalIndex - b.originalIndex
    ));
}

function buildChapterAlignedStories(entries: Array<{ story: SavedMicroStory; chapterNumber: number }>): Array<SavedMicroStory | undefined> {
  const aligned: Array<SavedMicroStory | undefined> = [];
  entries.forEach(({ story, chapterNumber }) => {
    aligned[chapterNumber - 1] = story;
  });
  return aligned;
}

function inferWriterMode(project: ReturnType<typeof useWorldSettings>['currentProject']): 'novel' | 'microdrama' {
  if (!project) return 'novel';
  return project.detailedOutlineMode === 'microdrama' ? 'microdrama' : 'novel';
}

const WRITER_AUTO_FLOW_MAX_AGE_MS = 5 * 60 * 1000;
const SSE_RECONNECT_GRACE_MS = 180000;
const literatureStyleNames: Record<string, string> = {
  realist_plain: '现实主义白描',
  literary_lyrical: '抒情文学',
  social_realism: '社会现实',
  family_saga: '家族叙事',
  coming_of_age: '成长小说',
  suspense_literary: '文学悬疑',
  psychological: '心理写实',
  rural_local: '乡土地方志',
  urban_drift: '都市漂泊',
  historical_texture: '历史质感',
  female_growth: '女性成长',
  youth_romance: '青春言情',
  essayistic: '散文化叙事',
  minimalist: '极简冷峻',
  warm_healing: '温暖治愈',
  noir_literary: '冷硬 noir',
  polyphonic: '群像复调',
  memoir_like: '回忆录式',
  humane_comedy: '人间喜剧',
  magazine_literary: '杂志文学',
  cinematic_literary: '电影感叙事',
  classic_translated: '译制文学感',
};

function buildFocusedCharacterContext(characters: string, isMicrodrama: boolean): string {
  const source = String(characters || '').trim();
  if (!source) return '';
  const limit = isMicrodrama ? 2200 : 1400;
  if (source.length <= limit) return source;

  const blocks = source
    .split(/(?=\n\s*(?:#{1,4}\s*)?(?:【[^】]{1,30}】|[一二三四五六七八九十\d]+[、.．]\s*[^：:\n]{1,30}|[-*]\s*[^：:\n]{1,30}[：:]))/g)
    .map((block, index) => ({ text: block.trim(), index }))
    .filter(item => item.text.length > 0);

  const scoreBlock = (text: string) => {
    let score = 0;
    if (/【核心人物与主线】|核心人物/.test(text)) score += 16;
    if (/主角|主人公|男主|女主|protagonist/i.test(text)) score += 14;
    if (/人物弧线总表|弧线总表|成长弧线/.test(text)) score += 10;
    if (/核心搭档|感情线|爱情线|主要配角|重要配角/.test(text)) score += 7;
    if (/贯穿主线|核心压力源|主反派|主要对手/.test(text)) score += 5;
    if (/反派|幕后|压力方/.test(text)) score += 2;
    if (/龙套|边缘见证者|普通群众/.test(text)) score -= 4;
    return score;
  };

  const selected: string[] = [];
  const used = new Set<number>();
  const sorted = blocks
    .map(item => ({ ...item, score: scoreBlock(item.text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  let total = 0;
  const addBlock = (item: { text: string; index: number }) => {
    if (used.has(item.index) || total >= limit) return;
    const remaining = limit - total;
    const clipped = item.text.length > remaining ? `${item.text.slice(0, Math.max(300, remaining))}...` : item.text;
    selected.push(clipped);
    used.add(item.index);
    total += clipped.length + 2;
  };

  sorted.forEach(addBlock);
  if (selected.length === 0) {
    return `${source.slice(0, limit)}...`;
  }

  return selected.join('\n\n');
}

export function WriterPage({ onBack, setIsAutoFlowRunning, setAutoFlowStep, setAutoFlowProgress }: WriterPageProps) {
  const { currentProject, updateProject, exportProject, clearNovelCacheForProject, syncProjectToCloud } = useWorldSettings();
  const writerMode = inferWriterMode(currentProject);
  const isMicrodrama = writerMode === 'microdrama';
  const isLiterature = currentProject?.detailedOutlineMode === 'literature';
  const unitLabel = isMicrodrama ? '集' : '章';
  const unitsPerMicroStory = 1;
  const storiesPerBatch = isMicrodrama ? 1 : 8;
  const unitsPerBatch = isMicrodrama ? 1 : 8;
  const [writerModelValue, setWriterModelValue] = useState(DEFAULT_WRITER_MODEL_VALUE);
  const writerModelOption = getWriterModelOption(writerModelValue);
  const writerModelRequest = toWriterModelRequest(writerModelValue);
  const [actionFirstScript, setActionFirstScript] = useState(false);
  const [targetEpisodeWords, setTargetEpisodeWords] = useState(800);
  const [targetNovelWords, setTargetNovelWords] = useState(2100);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [isGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const latestGeneratedContentRef = useRef<string>('');
  const [currentChapter, setCurrentChapter] = useState(1);
  const currentChapterRef = useRef(1);
  const [_totalChapters, setTotalChapters] = useState(0);
  const [previousChapterEnding, setPreviousChapterEnding] = useState<string>('');
  const [generatedChapters, setGeneratedChapters] = useState<{[key: number]: string}>({});
  const currentProjectRef = useRef(currentProject);
  const generatedChaptersRef = useRef<{[key: number]: string}>({});
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isFullCycleGenerating, setIsFullCycleGenerating] = useState(false);
  const [isSegmentGenerating, setIsSegmentGenerating] = useState(false);
  const [isSingleUnitGenerating, setIsSingleUnitGenerating] = useState(false);
  const [parallelLaneCount, setParallelLaneCount] = useState(5);
  const [segmentStartChapterInput, setSegmentStartChapterInput] = useState('');
  const [currentRequestId, setCurrentRequestId] = useState<string>('');
  const currentRequestIdRef = useRef('');
  const activeRequestIdsRef = useRef<Set<string>>(new Set());
  const activeEventSourcesRef = useRef<Set<EventSource>>(new Set());
  const generationCancelledRef = useRef(false);
  const generationLockRef = useRef(false);
  const autoWriterStartedRef = useRef(false);
  const lastAutoProjectSnapshotChapterCountRef = useRef(0);
  const autoSnapshotProjectIdRef = useRef<number | null>(null);
  const [autoFollowStreaming, setAutoFollowStreaming] = useState(true);
  const autoFollowStreamingRef = useRef(true);
  const [fullCycleProgress, setFullCycleProgress] = useState<{
    current: number;
    total: number;
    currentBatch: number;
    totalBatches: number;
    message: string;
    currentChapter?: number;
    currentChapterWords?: number;
  } | null>(null);
  const [segmentProgress, setSegmentProgress] = useState<{
    lanes: Array<{
      id: number;
      start: number;
      end: number;
      current: number | null;
      completed: number;
      total: number;
      status: 'pending' | 'running' | 'completed' | 'failed';
    }>;
    requestedLaneCount: number;
    completed: number;
    total: number;
    message: string;
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
  const [specificUnitInput, setSpecificUnitInput] = useState('');
  const [showChapterSelector, setShowChapterSelector] = useState(false);
  const [selectedStartChapter, setSelectedStartChapter] = useState<number | null>(null);
  const [isRegenerateMode, setIsRegenerateMode] = useState(false); // 是否为重新生成模式
  const [chapterListOrder, setChapterListOrder] = useState<'desc' | 'asc'>('desc');
  const [rewritePercent, setRewritePercent] = useState(20);
  const [isRewritingChapter, setIsRewritingChapter] = useState(false);
  const [isReviewingScripts, setIsReviewingScripts] = useState(false);
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);

  // 正文编辑：支持编辑已写内容并保存（落库到项目 generatedChapters）
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [chapterDraft, setChapterDraft] = useState('');
  const [chapterDraftTouched, setChapterDraftTouched] = useState(false);
  const pendingEditScrollYRef = useRef<number | null>(null);
  const contentEndRef = useRef<HTMLDivElement | null>(null);
  const wakeLockRef = useRef<any>(null);
  const noSleepVideoRef = useRef<HTMLVideoElement | null>(null);
  const noSleepCanvasIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 小故事必须按章节自然顺序排序（避免刷新/覆盖某一段后顺序错乱导致章节对照错位）
  const microStoriesInOrder = currentProject?.savedMicroStories
    ? sortSavedMicroStoriesForChapters(currentProject.savedMicroStories)
    : undefined;

  const microStoryCount = microStoriesInOrder?.length ?? 0;
  const chapterStoryEntries = buildChapterStoryEntries(microStoriesInOrder);
  const chapterStoryMap = new Map(chapterStoryEntries.map(entry => [entry.chapterNumber, entry.story] as const));
  const availableChapterNumbers = chapterStoryEntries.map(entry => entry.chapterNumber);
  const availableChapterNumberSet = new Set(availableChapterNumbers);
  const maxAvailableChapter = availableChapterNumbers.length > 0 ? Math.max(...availableChapterNumbers) : 0;
  const alignedMicroStoriesForWriting = buildChapterAlignedStories(chapterStoryEntries);
  const getMicroStoryForChapter = (chapterNumber: number) => chapterStoryMap.get(chapterNumber);
  const hasActiveGeneration = generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating || isReviewingScripts;
  const isStreamingCurrentChapter =
    generationState.isGenerating &&
    generationState.currentGeneratingChapter === currentChapter &&
    generatedContent.length > 0;

  useEffect(() => {
    currentProjectRef.current = currentProject;
    const projectId = currentProject?.id ?? null;
    if (projectId !== autoSnapshotProjectIdRef.current) {
      autoSnapshotProjectIdRef.current = projectId;
      lastAutoProjectSnapshotChapterCountRef.current = Object.keys(currentProject?.generatedChapters || {}).length;
    }
  }, [currentProject]);

  useEffect(() => {
    generatedChaptersRef.current = generatedChapters;
  }, [generatedChapters]);

  useEffect(() => {
    currentRequestIdRef.current = currentRequestId;
  }, [currentRequestId]);

  useEffect(() => {
    currentChapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    autoFollowStreamingRef.current = autoFollowStreaming;
  }, [autoFollowStreaming]);

  const registerGenerationRequest = (requestId: string, eventSource: EventSource) => {
    generationCancelledRef.current = false;
    activeRequestIdsRef.current.add(requestId);
    activeEventSourcesRef.current.add(eventSource);
    setCurrentRequestId(requestId);
    setCurrentEventSource(eventSource);
  };

  const releaseGenerationRequest = (requestId?: string, eventSource?: EventSource) => {
    if (requestId) activeRequestIdsRef.current.delete(requestId);
    if (eventSource) activeEventSourcesRef.current.delete(eventSource);
    if (!activeRequestIdsRef.current.size) setCurrentRequestId('');
    if (!activeEventSourcesRef.current.size) setCurrentEventSource(null);
  };

  const requestGenerationWakeLock = async () => {
    try {
      const nav = navigator as any;
      if (!nav?.wakeLock?.request || document.visibilityState !== 'visible') return;
      if (wakeLockRef.current && !wakeLockRef.current.released) return;
      wakeLockRef.current = await nav.wakeLock.request('screen');
      wakeLockRef.current.addEventListener?.('release', () => {
        wakeLockRef.current = null;
      });
      console.log('已启用屏幕常亮，生成期间不会自动进入屏保');
    } catch (error) {
      console.warn('当前浏览器未能启用屏幕常亮，生成会继续执行:', error);
    }
  };

  const startNoSleepVideoFallback = async () => {
    if (noSleepVideoRef.current) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.captureStream) return;

      let tick = 0;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1, 1);
      noSleepCanvasIntervalRef.current = setInterval(() => {
        tick += 1;
        ctx.fillStyle = tick % 2 === 0 ? '#000' : '#111';
        ctx.fillRect(0, 0, 1, 1);
      }, 1000);

      const video = document.createElement('video');
      video.setAttribute('aria-hidden', 'true');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.srcObject = canvas.captureStream(1);
      video.style.position = 'fixed';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.left = '-10px';
      video.style.bottom = '0';
      document.body.appendChild(video);
      await video.play();
      noSleepVideoRef.current = video;
      console.log('已启用隐藏视频保活，生成期间尽量阻止屏保');
    } catch (error) {
      if (noSleepCanvasIntervalRef.current) {
        clearInterval(noSleepCanvasIntervalRef.current);
        noSleepCanvasIntervalRef.current = null;
      }
      console.warn('隐藏视频保活未能启用，生成会继续执行:', error);
    }
  };

  const stopNoSleepVideoFallback = () => {
    if (noSleepCanvasIntervalRef.current) {
      clearInterval(noSleepCanvasIntervalRef.current);
      noSleepCanvasIntervalRef.current = null;
    }

    const video = noSleepVideoRef.current;
    noSleepVideoRef.current = null;
    if (!video) return;

    try {
      video.pause();
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      video.remove();
    } catch (error) {
      console.warn('关闭隐藏视频保活失败:', error);
    }
  };

  const releaseGenerationWakeLock = async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) {
      try {
        await lock.release();
      } catch (error) {
        console.warn('释放屏幕常亮失败:', error);
      }
    }
  };

  useEffect(() => {
    const shouldKeepAwake = generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating || isRewritingChapter || isReviewingScripts;
    if (shouldKeepAwake) {
      void requestGenerationWakeLock();
      void startNoSleepVideoFallback();
    } else {
      void releaseGenerationWakeLock();
      stopNoSleepVideoFallback();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && shouldKeepAwake) {
        void requestGenerationWakeLock();
        void startNoSleepVideoFallback();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (!shouldKeepAwake) return;
      void releaseGenerationWakeLock();
      stopNoSleepVideoFallback();
    };
  }, [generationState.isGenerating, isBatchGenerating, isFullCycleGenerating, isSegmentGenerating, isSingleUnitGenerating, isRewritingChapter, isReviewingScripts]);

  const visibleChapterContent = isEditingChapter
    ? chapterDraft
    : isStreamingCurrentChapter
      ? generatedContent
      : (generatedChapters[currentChapter] ?? generatedContent);
  const visibleChapterWords = getWordCount(visibleChapterContent || '');
  const rewriteTargetWords = Math.max(300, Math.round(visibleChapterWords * (1 + rewritePercent / 100)));
  const activeTargetWords = isMicrodrama
    ? normalizeTargetEpisodeWords(targetEpisodeWords)
    : normalizeTargetNovelWords(targetNovelWords);

  const hasChapter = (chapterNumber: number): boolean => {
    return generatedChapters[chapterNumber] !== undefined;
  };

  const getUnitRangeDisplay = (chapterNumber: number): string => {
    if (isMicrodrama) return `第${chapterNumber}集`;
    return `第${chapterNumber}章`;
  };

  // 现在网文与微短剧都按单个单位对应一个细纲
  const getBestExistingChapterInGroup = (groupStart: number): number | null => {
    if (hasChapter(groupStart)) return groupStart;
    return null;
  };

  const getActiveGeneratedChapters = (chapters?: {[key: number]: string}): {[key: number]: string} => {
    return chapters ?? {
      ...(currentProject?.generatedChapters || {}),
      ...generatedChapters,
    };
  };

  const getGeneratedChapterNumbers = (chapters?: {[key: number]: string}): number[] => {
    const activeChapters = getActiveGeneratedChapters(chapters);
    return Object.keys(activeChapters)
      .map(Number)
      .filter(chapter => Number.isFinite(chapter) && chapter > 0 && Boolean(activeChapters[chapter]));
  };

  const getLastGeneratedChapterNumber = (chapters?: {[key: number]: string}): number => {
    const chapterNumbers = getGeneratedChapterNumbers(chapters);
    return chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : 0;
  };

  // 计算下一个需要续写的章节：按真实章节号继续，允许小故事被删除后出现章节缺口。
  const getNextChapterToGenerate = (): number => {
    if (!isMicrodrama && availableChapterNumbers.length > 0) {
      const activeChapters = getActiveGeneratedChapters();
      const lastGenerated = getLastGeneratedChapterNumber(activeChapters);
      return availableChapterNumbers.find(chapter => chapter > lastGenerated && !activeChapters[chapter]) || (lastGenerated + 1);
    }
    return getLastGeneratedChapterNumber() + 1;
  };

  const isNearPageBottom = (threshold = 220): boolean => {
    const scrollBottom = window.innerHeight + window.scrollY;
    return document.documentElement.scrollHeight - scrollBottom <= threshold;
  };

  const enableStreamingFollow = () => {
    setAutoFollowStreaming(true);
    autoFollowStreamingRef.current = true;
  };

  const pauseStreamingFollow = () => {
    setAutoFollowStreaming(false);
    autoFollowStreamingRef.current = false;
  };

  const clearWriterAutoFlowFlags = () => {
    localStorage.removeItem('story-architect-auto-flow');
    localStorage.removeItem('story-architect-auto-flow-project-id');
    localStorage.removeItem('story-architect-auto-flow-source');
    localStorage.removeItem('story-architect-auto-flow-created-at');
  };

  const isFreshWriterAutoFlow = (expectedProjectId?: number | string): boolean => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    const autoFlowProjectId = localStorage.getItem('story-architect-auto-flow-project-id');
    const autoFlowSource = localStorage.getItem('story-architect-auto-flow-source');
    const createdAt = Number(localStorage.getItem('story-architect-auto-flow-created-at') || 0);
    const isCurrentAutoProject = !autoFlowProjectId || autoFlowProjectId === String(expectedProjectId || '');
    const isFresh = Number.isFinite(createdAt) && Date.now() - createdAt <= WRITER_AUTO_FLOW_MAX_AGE_MS;

    return (
      autoFlowFlag === 'writer' &&
      autoFlowSource === 'full-auto' &&
      isCurrentAutoProject &&
      isFresh
    );
  };

  // Writer页面状态持久化key
  const WRITER_STATE_KEY = currentProject?.id ? `writer-state-${currentProject.id}` : 'writer-state-default';

  // 检查自动化流程
  useEffect(() => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    const autoFlowProjectId = localStorage.getItem('story-architect-auto-flow-project-id');
    const projectGeneratedChapterCount = Object.keys(currentProject?.generatedChapters || {}).length;
    const restoredGeneratedChapterCount = Object.keys(generatedChaptersRef.current || {}).length;
    const hasAnyGeneratedChapters = projectGeneratedChapterCount > 0 || restoredGeneratedChapterCount > 0;
    const canStartWriterAutoFlow =
      isFreshWriterAutoFlow(currentProject?.id) &&
      Boolean(currentProject?.autoGenerationMode) &&
      Boolean(currentProject?.autoGenerationStarted) &&
      !hasAnyGeneratedChapters;

    if (
      autoFlowFlag === 'writer' &&
      canStartWriterAutoFlow &&
      !autoWriterStartedRef.current &&
      !generationState.isGenerating &&
      !isBatchGenerating &&
      !isFullCycleGenerating &&
      !isSegmentGenerating &&
      !isSingleUnitGenerating &&
      microStoriesInOrder &&
      microStoriesInOrder.length > 0
    ) {
      console.log('检测到自动化流程：开始自动执行一键循环生成');
      autoWriterStartedRef.current = true;
      clearWriterAutoFlowFlags();

      // 更新自动化状态
      if (setAutoFlowStep) setAutoFlowStep('正在自动点击"一键循环生成"...');
      if (setAutoFlowProgress) setAutoFlowProgress(100);

      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        if (!generationCancelledRef.current) {
          if (isMicrodrama) {
            generateFullCycleContent();
          } else {
            generateSegmentParallelContent({ skipConfirm: true, requestedLaneCount: 5, startChapter: 1 });
          }
        }
      }, 1000);
    } else if (autoFlowFlag === 'writer' && (!canStartWriterAutoFlow || autoFlowProjectId === String(currentProject?.id || ''))) {
      console.log('检测到不可用或过期的正文自动化标记，已清理，避免进入正文页后自动续写');
      clearWriterAutoFlowFlags();
    }
  }, [currentProject?.id, currentProject?.autoGenerationMode, currentProject?.autoGenerationStarted, currentProject?.generatedChapters, generationState.isGenerating, isBatchGenerating, isFullCycleGenerating, isSegmentGenerating, isSingleUnitGenerating, microStoriesInOrder, setAutoFlowStep, setAutoFlowProgress]);

  // 从localStorage和项目中恢复状态
  useEffect(() => {
    // 旧版本可能留下 writer-batch 自动标记。正文页不再因为进入页面而自动开写。
    const explicitBatchAutoFlow =
      localStorage.getItem('story-architect-auto-flow') === 'writer-batch' &&
      localStorage.getItem('story-architect-auto-flow-project-id') === String(currentProject?.id || '');
    if (explicitBatchAutoFlow) {
      console.log('检测到旧的批量自动化标记，已清理；进入正文写作工作室后等待用户手动点击生成');
      clearWriterAutoFlowFlags();
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
          setActionFirstScript(Boolean(state.actionFirstScript));
          setTargetEpisodeWords(normalizeTargetEpisodeWords(state.targetEpisodeWords));
          setTargetNovelWords(normalizeTargetNovelWords(state.targetNovelWords));
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
          setActionFirstScript(Boolean(state.actionFirstScript));
          setTargetEpisodeWords(normalizeTargetEpisodeWords(state.targetEpisodeWords));
          setTargetNovelWords(normalizeTargetNovelWords(state.targetNovelWords));
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

  const buildWriterStateSnapshot = (chapters: {[key: number]: string} = generatedChapters) => ({
    generatedContent: isEditingChapter ? chapterDraft : generatedContent,
    currentChapter,
    previousChapterEnding,
    actionFirstScript,
    targetEpisodeWords,
    targetNovelWords,
    generatedChapters: chapters,
    generationState,
    timestamp: Date.now()
  });

  const saveWriterStateToLocalStorage = (chapters: {[key: number]: string} = generatedChapters) => {
    const snapshot = buildWriterStateSnapshot(chapters);
    const projectId = currentProjectRef.current?.id ?? currentProject?.id;
    if (projectId) {
      localStorage.setItem(`writer-state-${projectId}`, JSON.stringify(snapshot));
    }
    localStorage.setItem('writer-state-default', JSON.stringify(snapshot));
  };

  // 保存状态到localStorage
  const saveWriterState = () => {
    try {
      saveWriterStateToLocalStorage(generatedChapters);
      console.log('Writer页面状态已保存到localStorage');
    } catch (error) {
      console.error('保存Writer页面状态失败:', error);
    }
  };

  const createWriterSaveVersion = (chapters: {[key: number]: string}, idPrefix: 'save' | 'auto_save') => {
    const chapterValues = Object.keys(chapters)
      .map(Number)
      .sort((a, b) => a - b)
      .map(chapter => chapters[chapter])
      .filter(Boolean);

    return {
      id: `${idPrefix}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      chapterCount: chapterValues.length,
      totalWords: chapterValues.reduce((sum, content) => sum + getWordCount(content), 0),
      chapters: { ...chapters },
      preview: chapterValues[0]?.substring(0, 200) + '...' || ''
    };
  };

  const saveProjectSnapshot = (
    chapters: {[key: number]: string},
    opts?: { silent?: boolean; auto?: boolean; message?: string }
  ): boolean => {
    const project = currentProjectRef.current;
    if (!project || Object.keys(chapters).length === 0) {
      if (!opts?.silent) alert('没有可保存的内容');
      return false;
    }

    const saveVersion = createWriterSaveVersion(chapters, opts?.auto ? 'auto_save' : 'save');
    const savedVersions = [saveVersion, ...(project.savedVersions || [])].slice(0, 10);
    const updatedProject = {
      ...project,
      generatedChapters: { ...chapters },
      savedVersions,
      updatedAt: new Date().toISOString(),
    };

    currentProjectRef.current = updatedProject;
    updateProject(project.id, {
      generatedChapters: updatedProject.generatedChapters,
      savedVersions,
    });
    saveWriterStateToLocalStorage(chapters);
    lastAutoProjectSnapshotChapterCountRef.current = Math.max(
      lastAutoProjectSnapshotChapterCountRef.current,
      Object.keys(chapters).length
    );

    console.log(opts?.auto ? '自动保存项目快照:' : '手动保存项目快照:', {
      chapterCount: saveVersion.chapterCount,
      totalWords: saveVersion.totalWords,
    });

    if (!opts?.silent) {
      alert(opts?.message || '项目已保存！正文、版本历史和当前写作进度都已更新。');
    }
    return true;
  };

  const maybeAutoSaveProjectSnapshot = (chapters: {[key: number]: string}) => {
    const chapterCount = Object.keys(chapters).length;
    if (chapterCount <= 0) return;
    const lastSavedCount = lastAutoProjectSnapshotChapterCountRef.current;
    if (chapterCount - lastSavedCount < 10) return;
    saveProjectSnapshot(chapters, {
      silent: true,
      auto: true,
      message: `已自动保存到第${chapterCount}${unitLabel}`,
    });
  };

  const persistGeneratedChapters = (patch: {[key: number]: string}) => {
    const project = currentProjectRef.current;
    const mergedChapters = {
      ...(project?.generatedChapters || {}),
      ...generatedChaptersRef.current,
      ...patch,
    };

    generatedChaptersRef.current = mergedChapters;
    setGeneratedChapters(mergedChapters);

    try {
      if (project?.id) {
        currentProjectRef.current = {
          ...project,
          generatedChapters: mergedChapters,
          updatedAt: new Date().toISOString(),
        };
        updateProject(project.id, { generatedChapters: mergedChapters });
      }
      saveWriterStateToLocalStorage(mergedChapters);
      maybeAutoSaveProjectSnapshot(mergedChapters);
    } catch (error) {
      console.error('实时保存章节失败:', error);
    }

    return mergedChapters;
  };

  // 定期保存状态（每30秒）
  useEffect(() => {
    const interval = setInterval(saveWriterState, 30000);
    return () => clearInterval(interval);
  }, [generatedContent, currentChapter, previousChapterEnding, actionFirstScript, targetEpisodeWords, targetNovelWords, generatedChapters, generationState]);

  // 离开页面时保存状态
  useEffect(() => {
    return () => {
      saveWriterState();
    };
  }, []);

  // 监听章节切换和内容更新，确保显示最新内容
  useEffect(() => {
    if (isEditingChapter) return;
    if (generationState.isGenerating) return;
    if (generatedChapters[currentChapter]) {
      setGeneratedContent(generatedChapters[currentChapter]);
    }
  }, [currentChapter, generatedChapters, isEditingChapter, generationState.isGenerating]);

  // 非编辑状态下，同步草稿为当前章节内容（避免切换章节后草稿残留）
  useEffect(() => {
    if (isEditingChapter) return;
    if (generationState.isGenerating) return;
    const next = generatedChapters[currentChapter] ?? generatedContent ?? '';
    setChapterDraft(next);
    setChapterDraftTouched(false);
  }, [currentChapter, generatedChapters, generatedContent, isEditingChapter, generationState.isGenerating]);

  // 保持对“当前可见生成内容”的最新引用，供终止生成时保存“有多少算多少”
  useEffect(() => {
    latestGeneratedContentRef.current = generatedContent || '';
  }, [generatedContent]);

  useEffect(() => {
    if (pendingEditScrollYRef.current === null) return;
    const scrollY = pendingEditScrollYRef.current;
    pendingEditScrollYRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
  }, [isEditingChapter]);

  useEffect(() => {
    if (!generationState.isGenerating) {
      enableStreamingFollow();
      return;
    }

    const handleScroll = () => {
      if (isNearPageBottom() && currentChapterRef.current === generationState.currentGeneratingChapter) {
        enableStreamingFollow();
      } else {
        pauseStreamingFollow();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [generationState.isGenerating, generationState.currentGeneratingChapter]);

  const followLatestStreamingOutput = () => {
    const streamingChapter = generationState.currentGeneratingChapter;
    if (!streamingChapter) return;
    setIsEditingChapter(false);
    setChapterDraftTouched(false);
    setCurrentChapter(streamingChapter);
    setJumpToChapter(streamingChapter.toString());
    enableStreamingFollow();
    requestAnimationFrame(() => {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  useEffect(() => {
    if (!generationState.isGenerating || isEditingChapter || !generatedContent) return;
    if (!autoFollowStreamingRef.current) return;
    if (currentChapterRef.current !== generationState.currentGeneratingChapter) return;
    requestAnimationFrame(() => {
      contentEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, [generatedContent, generationState.isGenerating, generationState.currentGeneratingChapter, isEditingChapter]);

  // 保存生成的内容到项目
  const saveGeneratedContent = (opts?: { silent?: boolean }) => {
    const project = currentProjectRef.current;
    if (!project) {
      if (!opts?.silent) alert('未找到当前项目');
      return null;
    }

    const contentToSave = visibleChapterContent?.trim();
    const chaptersToSave = {
      ...(project.generatedChapters || {}),
      ...generatedChaptersRef.current,
      ...(contentToSave ? { [currentChapter]: contentToSave } : {}),
    };

    if (Object.keys(chaptersToSave).length === 0) {
      if (!opts?.silent) alert('没有可保存的内容');
      return null;
    }

    generatedChaptersRef.current = chaptersToSave;
    setGeneratedChapters(chaptersToSave);
    if (contentToSave) {
      setGeneratedContent(contentToSave);
    }

    const saved = saveProjectSnapshot(chaptersToSave, {
      silent: opts?.silent,
      message: '项目已保存！正文、版本历史和当前写作进度都已更新。',
    });
    return saved ? chaptersToSave : null;
  };

  const saveGeneratedContentAndSyncCloud = async () => {
    const project = currentProjectRef.current;
    const chaptersToSave = saveGeneratedContent({ silent: true });
    if (!project || !chaptersToSave) return;

    setIsCloudSyncing(true);
    try {
      const ok = await syncProjectToCloud(project.id, { chapters: chaptersToSave });
      alert(ok ? '已保存并同步到云端。' : '本地已保存，但云端同步未完成：请确认激活码后重试。');
    } catch (error) {
      console.error('保存并同步云端失败:', error);
      alert('本地已保存，但云端同步失败。请稍后重试。');
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const exportCurrentProjectJson = () => {
    const project = currentProjectRef.current;
    if (!project) {
      alert('未找到当前项目');
      return;
    }

    saveGeneratedContent({ silent: true });
    exportProject(currentProjectRef.current || project);
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
  const confirmDiscardChapterEdits = (): boolean => {
    if (!isEditingChapter) return true;
    if (!chapterDraftTouched) return true;
    return confirm(`你有未保存的正文修改，确定要丢弃并离开当前${unitLabel}吗？`);
  };

  const handleBackWithSaveGuard = () => {
    if (hasActiveGeneration) return;

    const savedCurrentContent = generatedChapters[currentChapter] || '';
    const currentVisibleContent = (visibleChapterContent || '').trim();
    const hasUnsavedEdit = isEditingChapter && chapterDraftTouched;
    const hasUnpersistedVisibleContent = currentVisibleContent && currentVisibleContent !== savedCurrentContent.trim();

    if (hasUnsavedEdit || hasUnpersistedVisibleContent) {
      const confirmed = confirm(
        `当前第${currentChapter}${unitLabel}可能还有未保存内容。\n\n确定已经保存好，再返回上一页吗？`
      );
      if (!confirmed) return;
    } else {
      const confirmed = confirm('返回上一页前，请确认当前项目内容已经保存。确定返回吗？');
      if (!confirmed) return;
    }

    onBack();
  };

  const jumpToChapterGroup = () => {
    if (!confirmDiscardChapterEdits()) return;
    const targetChapter = parseInt(jumpToChapter);
    if (isNaN(targetChapter) || targetChapter < 1) {
      alert(`请输入有效的${unitLabel}编号`);
      return;
    }

    const groupStart = targetChapter;
    const hasOutline = availableChapterNumberSet.size === 0 || availableChapterNumberSet.has(targetChapter);
    const best = hasChapter(targetChapter) ? targetChapter : getBestExistingChapterInGroup(groupStart);

    if (best !== null) {
      if (generationState.isGenerating && best !== generationState.currentGeneratingChapter) {
        pauseStreamingFollow();
      }
      setIsEditingChapter(false);
      setChapterDraftTouched(false);
      setCurrentChapter(best);
      setGeneratedContent(generatedChapters[best] || '');
      setJumpToChapter(best.toString()); // 保持当前值而不是清空
      return;
    }

    if (hasOutline) {
      setIsEditingChapter(false);
      setChapterDraftTouched(false);
      setCurrentChapter(targetChapter);
      setGeneratedContent('');
      setJumpToChapter(targetChapter.toString());
      return;
    }

    const availableChapters = availableChapterNumbers.length > 0
      ? availableChapterNumbers
      : Object.keys(generatedChapters).map(Number).sort((a, b) => a - b);
    alert(isMicrodrama
      ? `第${targetChapter}集没有对应分集细纲。可用分集: ${availableChapters.join(', ')}`
      : `第${targetChapter}章没有对应小故事细纲。可用章节: ${availableChapters.join(', ')}`);
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

  const makeSafeExportFilename = (name: string) => (
    name.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').replace(/_+/g, '_') || '正文导出'
  );

  const stripDuplicatedUnitHeading = (content: string, unitNumber: number) => {
    const trimmed = content.trim();
    const lines = trimmed.split(/\r?\n/);
    const firstLine = (lines[0] || '').trim();
    const headingPattern = new RegExp(`^(#{1,6}\\s*)?第\\s*${unitNumber}\\s*[章节集回幕节](\\s|[：:、.．-]|$)`);

    if (headingPattern.test(firstLine)) {
      return lines.slice(1).join('\n').trim();
    }

    return trimmed;
  };

  const buildMarkdownExport = () => {
    const chapterNumbers = Object.keys(generatedChapters)
      .map(Number)
      .filter(chapterNum => generatedChapters[chapterNum]?.trim())
      .sort((a, b) => a - b);
    const projectTitle = currentProject?.bookName || (isMicrodrama ? '微短剧剧本' : '小说正文');
    const exportType = isMicrodrama ? '微短剧剧本' : isLiterature ? '文学作品正文' : '网文正文';
    const totalWords = chapterNumbers.reduce((sum, chapterNum) => (
      sum + (generatedChapters[chapterNum] || '').replace(/\s/g, '').length
    ), 0);
    const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    const toc = chapterNumbers
      .map(chapterNum => `- [第${chapterNum}${unitLabel}](#第${chapterNum}${unitLabel})`)
      .join('\n');
    const chapterBlocks = chapterNumbers
      .map(chapterNum => {
        const content = stripDuplicatedUnitHeading(generatedChapters[chapterNum], chapterNum);
        return `## 第${chapterNum}${unitLabel}\n\n${content || '> 本章暂无正文。'}`;
      })
      .join('\n\n---\n\n');

    return [
      `# ${projectTitle}`,
      '',
      `> 类型：${exportType}`,
      `> 导出时间：${exportedAt}`,
      `> 已生成：${chapterNumbers.length}${unitLabel}`,
      `> 正文总字数：约 ${totalWords.toLocaleString('zh-CN')} 字`,
      '',
      '---',
      '',
      '## 目录',
      '',
      toc,
      '',
      '---',
      '',
      chapterBlocks,
      ''
    ].join('\n');
  };

  const downloadMarkdownFile = (markdownContent: string, filename: string) => {
    const normalizedFilename = filename.toLowerCase().endsWith('.md') ? filename : `${filename}.md`;
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = normalizedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 导出为精排 Markdown
  const exportAsMarkdown = async () => {
    if (Object.keys(generatedChapters).length === 0) {
      alert('没有可导出的内容');
      return;
    }

    try {
      const projectTitle = currentProject?.bookName || (isMicrodrama ? '微短剧剧本' : '小说正文');
      if (isMicrodrama && currentProject) {
        setIsExportingMarkdown(true);
        const response = await blueprintApi.exportMicrodramaMarkdown({
          chapters: generatedChapters,
          bookName: projectTitle,
          outline: currentProject.outline,
          worldSetting: currentProject.worldSetting,
          characters: currentProject.characters,
          detailedOutline: currentProject.detailedOutline,
          savedMicroStories: currentProject.savedMicroStories
        });
        downloadMarkdownFile(response.data, response.filename || `${makeSafeExportFilename(projectTitle)}v1.md`);
        return;
      }

      const markdownContent = buildMarkdownExport();
      downloadMarkdownFile(markdownContent, `${makeSafeExportFilename(projectTitle)}.md`);

      console.log('Markdown内容已导出');
    } catch (error) {
      console.error('导出Markdown失败:', error);
      alert(isMicrodrama ? '导出审核Markdown失败，请稍后重试' : '导出失败，请稍后重试');
    } finally {
      setIsExportingMarkdown(false);
    }
  };

  // 终止生成
  const stopGeneration = async () => {
    const hasActiveGeneration =
      generationState.isGenerating ||
      isBatchGenerating ||
      isFullCycleGenerating ||
      isSegmentGenerating ||
      isSingleUnitGenerating ||
      activeRequestIdsRef.current.size > 0 ||
      activeEventSourcesRef.current.size > 0 ||
      !!currentEventSource;
    if (!hasActiveGeneration) return;

    const confirmed = confirm('确定要终止当前生成吗？已完成的章节会保留，未完成的章节会被丢弃。');
    if (!confirmed) return;

    generationCancelledRef.current = true;
    generationLockRef.current = false;
    clearWriterAutoFlowFlags();
    localStorage.removeItem('story-architect-auto-export-json');

    try {
      const requestIds = Array.from(new Set([
        ...activeRequestIdsRef.current,
        currentRequestIdRef.current,
        currentRequestId,
      ].filter(Boolean)));
      if (requestIds.length > 0) {
        await Promise.allSettled(requestIds.map(requestId => blueprintApi.cancelGeneration(requestId)));
        console.log('已发送终止请求到后台:', requestIds);
      } else {
        console.warn('当前没有可取消的requestId，仅关闭前端连接');
      }

      // 关闭所有已知SSE连接。全循环和批量生成可能各自持有一个连接。
      activeEventSourcesRef.current.forEach(eventSource => eventSource.close());
      activeEventSourcesRef.current.clear();
      if (currentEventSource) {
        currentEventSource.close();
      }
      activeRequestIdsRef.current.clear();
      setCurrentEventSource(null);
      console.log('SSE连接已关闭');
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
    // 关键：同步退出所有“生成中”UI状态，恢复章节编辑入口
    setIsBatchGenerating(false);
    setIsFullCycleGenerating(false);
    setIsSegmentGenerating(false);
    setIsSingleUnitGenerating(false);
    setFullCycleProgress(null);
    setSegmentProgress(null);
    setCurrentRequestId('');
    currentRequestIdRef.current = '';

    if (currentProject?.id) {
      updateProject(currentProject.id, {
        autoSelectedStories: false,
        autoGenerationMode: false,
        autoGenerationStarted: false,
      });
    }

    // 保持在当前生成位置：将当前流式内容尽可能保存到当前章节（有多少算多少）
    const activeChapter = generationState.currentGeneratingChapter ?? currentChapter;
    const partialContent = (latestGeneratedContentRef.current || '').trim();
    if (partialContent) {
      const updatedChapters = { ...generatedChapters, [activeChapter]: partialContent };
      setGeneratedChapters(updatedChapters);
      setCurrentChapter(activeChapter);
      setGeneratedContent(partialContent);

      if (currentProject?.id) {
        updateProject(currentProject.id, {
          generatedChapters: updatedChapters
        });
      }
    }

    // 保存当前状态
    saveWriterState();

    alert('生成已终止，当前章节已按已生成内容保存。');
  };

  // 重置生成状态
  const resetGeneration = () => {
    const confirmed = confirm('确定要重置吗？这将清除所有已生成的章节内容，返回空白状态。');
    if (!confirmed) return;

    // 同时清理项目持久化的正文缓存，避免刷新后又被恢复出来（并释放localStorage空间）
    if (currentProject?.id) {
      clearNovelCacheForProject(currentProject.id);
    }

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
    // 初始化/更新总单元数（网文每个小故事 1 章；微短剧每个小故事 1 集）
    if (!microStoryCount) return;
    const calculatedTotalChapters = isMicrodrama
      ? Math.floor(microStoryCount * unitsPerMicroStory)
      : (maxAvailableChapter || Math.floor(microStoryCount * unitsPerMicroStory));
    setTotalChapters(calculatedTotalChapters);

    // 不要在这里强制重置 currentChapter（否则会导致“保存/更新”后无法跳转）
    // 只在章节越界时做纠正
    setCurrentChapter(prev => {
      if (!Number.isFinite(prev) || prev < 1) return 1;
      if (calculatedTotalChapters > 0 && prev > calculatedTotalChapters) return 1;
      return prev;
    });
  }, [isMicrodrama, maxAvailableChapter, microStoryCount, unitsPerMicroStory]);


  // 批量生成内容：小说每批8章，微短剧每次1集
  const generateBatchContent = async (expectedStartChapter?: number, expectedChapterCount?: number) => {
    if (generationLockRef.current || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating) {
      console.warn('已有正文生成任务正在运行，忽略新的批量生成请求');
      return;
    }
    generationLockRef.current = true;
    generationCancelledRef.current = false;

    if (!currentProject) {
      generationLockRef.current = false;
      alert('未找到当前项目');
      return;
    }

    // 优先使用已选择的小故事，否则使用所有保存的小故事
    const microStoriesToUse = isMicrodrama
      ? (currentProject.selectedMicroStories || microStoriesInOrder)
      : alignedMicroStoriesForWriting;

    // 如果是全流程自动生成，允许生成更少的小故事；手动生成时保持原有要求
    const isAutoFlow = expectedStartChapter !== undefined && expectedChapterCount !== undefined;
    if (!isAutoFlow && (!microStoriesToUse || microStoriesToUse.length < storiesPerBatch)) {
      generationLockRef.current = false;
      alert(`需要至少保存${storiesPerBatch}个${isMicrodrama ? '分集' : '小故事'}才能进行批量生成`);
      return;
    }
    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      generationLockRef.current = false;
      alert(`没有找到保存的${isMicrodrama ? '分集' : '小故事'}，请先在情节结构细化页面生成并保存${isMicrodrama ? '分集' : '小故事'}`);
      return;
    }

    setIsBatchGenerating(true);

    try {
      const generationContext = buildGenerationContext();
      console.log('批量生成上下文长度:', generationContext.length);
      const requestedBatchUnitCount = expectedChapterCount ?? unitsPerBatch;

      // 计算起始章节
      const activeGeneratedChapters = getActiveGeneratedChapters();
      const existingChapters = getGeneratedChapterNumbers(activeGeneratedChapters).length;
      const startChapter = expectedStartChapter ?? (existingChapters > 0
        ? getLastGeneratedChapterNumber(activeGeneratedChapters) + 1
        : 1);
      const totalAvailableChapters = microStoriesToUse.length * unitsPerMicroStory;
      if (startChapter > totalAvailableChapters) {
        setIsBatchGenerating(false);
        generationLockRef.current = false;
        alert(`当前项目已经写到第${getLastGeneratedChapterNumber(activeGeneratedChapters)}${unitLabel}，没有可继续生成的${unitLabel}。`);
        return;
      }
      const batchUnitCount = Math.min(requestedBatchUnitCount, totalAvailableChapters - startChapter + 1);

      console.log(`开始流式生成${batchUnitCount}${unitLabel}内容...`);

      // 初始化生成状态
      setGenerationState({
        isGenerating: true,
        currentGeneratingChapter: startChapter,
        totalChapters: batchUnitCount,
        completedChapters: []
      });

      // 用“已保存的最新正文”动态计算衔接参考（避免 previousChapterEnding 过期）
      const effectivePreviousEnding =
        startChapter > 1 ? computePreviousEndingFromChapters(activeGeneratedChapters, startChapter) : '';

      // 先准备流式请求，获取requestId
      const prepareResponse = await blueprintApi.prepareChapterStream({
        context: generationContext,
        chapterNumber: startChapter,
        unitCount: batchUnitCount,
        previousEnding: effectivePreviousEnding || undefined,
	        savedMicroStories: microStoriesToUse,
	        mode: writerMode,
	        ...writerModelRequest,
	        actionFirstScript: isMicrodrama ? actionFirstScript : undefined,
	        targetEpisodeWords: isMicrodrama ? normalizeTargetEpisodeWords(targetEpisodeWords) : undefined,
	        targetNovelWords: !isMicrodrama ? normalizeTargetNovelWords(targetNovelWords) : undefined,
	        // 只要不是从第1章开始，就把已保存的正文一并传给后端，保证“引用”走最新文档
	        generatedChapters: startChapter > 1 ? activeGeneratedChapters : undefined
      });

      const requestId = prepareResponse.requestId;
      console.log('获取到requestId:', requestId);

      // 使用SSE进行流式生成
	      const eventSource = blueprintApi.generateChapterStream(requestId);
	      registerGenerationRequest(requestId, eventSource);

	      let generatedChaptersData: {[key: number]: string} = {};
	      let activeStreamingChapter = startChapter;
	      const completedStreamingChapters = new Set<number>();
	      let lastSseEventAt = Date.now();
	      let sseErrorTimer: ReturnType<typeof setTimeout> | null = null;

      eventSource.onmessage = (event) => {
        try {
          lastSseEventAt = Date.now();
          if (sseErrorTimer) {
            clearTimeout(sseErrorTimer);
            sseErrorTimer = null;
          }
          const data = JSON.parse(event.data);
          if (generationCancelledRef.current) {
            eventSource.close();
            releaseGenerationRequest(requestId, eventSource);
            return;
          }
          console.log('收到SSE消息:', data.type, data.chapter || '');

          switch (data.type) {
            case 'ping':
              break;

            case 'duplicate_stream':
              console.warn(data.message || '重复的流式连接已忽略');
              eventSource.close();
              releaseGenerationRequest(requestId, eventSource);
              setIsBatchGenerating(false);
              generationLockRef.current = false;
              break;

            case 'start':
              console.log(data.message);
              setGenerationState(prev => ({
                ...prev,
                isGenerating: true,
                totalChapters: batchUnitCount
              }));
              break;

	            case 'story_start':
	              console.log(data.message);
	              activeStreamingChapter = data.chapters[0];
	              setGenerationState(prev => ({
	                ...prev,
	                currentGeneratingChapter: activeStreamingChapter
	              }));
	              // 只有处在“跟随最新输出”模式时，才自动切到正在生成的章节。
	              if (autoFollowStreamingRef.current) {
	                setCurrentChapter(activeStreamingChapter);
	                setJumpToChapter(activeStreamingChapter.toString());
	              }
	              setGeneratedContent(''); // 清空内容，准备显示新的小故事
	              break;

	            case 'story_chunk':
	              if (data.content) {
	                const cleanContent = cleanWriterContent(data.content);
	                const streamingChapter = data.chapter || activeStreamingChapter;
	                if (completedStreamingChapters.has(streamingChapter)) {
	                  break;
	                }
	                activeStreamingChapter = streamingChapter;

	                // 实时显示小故事生成过程
	                if (autoFollowStreamingRef.current) {
	                  setCurrentChapter(streamingChapter);
	                  setJumpToChapter(streamingChapter.toString());
	                }
	                setGenerationState(prev => ({
	                  ...prev,
	                  currentGeneratingChapter: streamingChapter
	                }));
	                setGeneratedContent(cleanContent);
	                console.log(`第${data.storyIndex}个小故事实时更新，当前长度: ${cleanContent.length}`);
	              }
              break;

            case 'chapter_complete':
              if (data.content) {
                const cleanContent = cleanWriterContent(data.content);
                completedStreamingChapters.add(data.chapter);
                generatedChaptersData[data.chapter] = cleanContent;

                // 每章完成立即落库，避免中断或刷新后丢章节
                persistGeneratedChapters({ [data.chapter]: cleanContent });

                // 更新生成状态
                setGenerationState(prev => ({
                  ...prev,
                  completedChapters: [...prev.completedChapters, data.chapter],
                  currentGeneratingChapter: data.chapter + 1 <= startChapter + batchUnitCount - 1 ? data.chapter + 1 : null
                }));

	                // 如果当前完成的是正在流式显示的单元，继续显示最终内容
	                if (data.chapter === activeStreamingChapter) {
	                  setGeneratedContent(cleanContent);
	                }

                console.log(`第${data.chapter}${unitLabel}生成完成，字数: ${getWordCount(cleanContent)}`);
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
              releaseGenerationRequest(requestId, eventSource);
              setIsBatchGenerating(false);
              setIsFullCycleGenerating(false);
              setFullCycleProgress(null);
              generationLockRef.current = false;
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
                const updatedChapters = persistGeneratedChapters(generatedChaptersData);

                // 重置生成状态
                const totalGenerated = Object.keys(updatedChapters).length;
                setGenerationState({
                  isGenerating: false,
                  currentGeneratingChapter: null,
                  totalChapters: 0,
                  completedChapters: []
                });

                console.log(`批量生成完成！共生成了${totalGenerated}个${unitLabel}的内容`);
                if (Object.keys(generatedChaptersData).length >= batchUnitCount) {
                  alert(isMicrodrama
                    ? `第${startChapter}集生成完成！现在可以继续生成后续分集。`
                    : `第一批8章生成完成！现在可以点击"继续生成9~16章"按钮生成后续内容`);
                } else {
                  alert(`批量生成完成！共生成了${totalGenerated}个${unitLabel}的内容`);
                }
                eventSource.close();
                if (sseErrorTimer) clearTimeout(sseErrorTimer);
                releaseGenerationRequest(requestId, eventSource);
                setIsBatchGenerating(false);
                generationLockRef.current = false;
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
                generationLockRef.current = false;
                alert('生成过程中出现错误，但已保存已完成的内容');
              }
              break;
          }
        } catch (error) {
          console.error('解析SSE消息失败:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('SSE连接暂时中断，等待浏览器自动重连:', error);
        if (sseErrorTimer) clearTimeout(sseErrorTimer);
        sseErrorTimer = setTimeout(() => {
          if (Date.now() - lastSseEventAt < SSE_RECONNECT_GRACE_MS) return;
          console.error('SSE连接超过180秒没有恢复，停止前端等待');
          alert('生成连接中断超过180秒，请刷新页面查看已保存章节，或从下一章继续生成');
          eventSource.close();
          releaseGenerationRequest(requestId, eventSource);
          setGenerationState({
            isGenerating: false,
            currentGeneratingChapter: null,
            totalChapters: 0,
            completedChapters: []
          });
          setIsBatchGenerating(false);
          generationLockRef.current = false;
        }, SSE_RECONNECT_GRACE_MS);
      };

    } catch (error) {
      console.error('批量生成章节内容失败:', error);
      alert('生成失败，请稍后重试');
      setIsBatchGenerating(false);
      generationLockRef.current = false;
    }
  };

  const parseSpecificUnitNumbers = (input: string): number[] => {
    const normalized = input
      .replace(/[，、；;]/g, ',')
      .replace(/[~～—–]/g, '-');
    const numbers = new Set<number>();

    normalized.split(',').forEach(part => {
      const item = part.trim();
      if (!item) return;
      const rangeMatch = item.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        for (let value = low; value <= high; value += 1) {
          numbers.add(value);
        }
        return;
      }

      const single = Number(item);
      if (Number.isFinite(single)) {
        numbers.add(single);
      }
    });

    return Array.from(numbers)
      .filter(value => Number.isInteger(value) && value > 0)
      .sort((a, b) => a - b);
  };

  const getNextOutlinedUnitAfter = (unitNumber: number): number | null => {
    const next = availableChapterNumbers.find(chapter => chapter > unitNumber);
    return typeof next === 'number' && Number.isFinite(next) ? next : null;
  };

  const buildNextOutlineBridge = (unitNumber: number): string => {
    const nextUnit = getNextOutlinedUnitAfter(unitNumber);
    if (!nextUnit) return '';
    const nextStoryData = getMicroStoryForChapter(nextUnit);
    if (!nextStoryData) return '';

    return `\n\n【下一${unitLabel}细纲衔接参考】\n下一${unitLabel}是第${nextUnit}${unitLabel}：${nextStoryData.title}\n${String(nextStoryData.content || '').substring(0, 600)}\n\n当前只需要让第${unitNumber}${unitLabel}结尾能够自然承接到下一${unitLabel}的剧情方向，不能提前写下一${unitLabel}的正文内容。`;
  };

  const generateSingleUnitContent = async (
    unitNumber: number,
    chaptersForContinuity: {[key: number]: string},
    opts: { completedUnits: number[]; total: number },
  ): Promise<string> => {
    if (!currentProject) throw new Error('未找到当前项目');
    const storyData = getMicroStoryForChapter(unitNumber);
    if (!storyData) {
      throw new Error(`第${unitNumber}${unitLabel}缺少对应${isMicrodrama ? '分集' : '小故事'}细纲`);
    }

    const microStoriesToUse = isMicrodrama
      ? microStoriesInOrder
      : alignedMicroStoriesForWriting;
    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      throw new Error(`没有找到保存的${isMicrodrama ? '分集' : '小故事'}细纲`);
    }

    const effectivePreviousEnding =
      unitNumber > 1 ? computePreviousEndingFromChapters(chaptersForContinuity, unitNumber) : '';
    const nextStoryBridge = buildNextOutlineBridge(unitNumber);
    const generationContext = buildGenerationContext(unitNumber, 1);

    setCurrentChapter(unitNumber);
    setJumpToChapter(unitNumber.toString());
    setGeneratedContent('');
    setIsEditingChapter(false);
    setChapterDraftTouched(false);
    setGenerationState({
      isGenerating: true,
      currentGeneratingChapter: unitNumber,
      totalChapters: opts.total,
      completedChapters: [...opts.completedUnits],
    });

    const prepareResponse = await blueprintApi.prepareChapterStream({
      context: `${generationContext}

【指定单${unitLabel}补写任务】
本次只生成第${unitNumber}${unitLabel}，这是一次补空白/补缺章任务，不是循环生成。无论上下文里还有多少细纲，都必须只写这一${unitLabel}。
上一${unitLabel}正文结尾会通过“previousEnding”提供，请从那个情绪、动作或叙事位置自然续上。
如果存在下一${unitLabel}，只能参考下一${unitLabel}的小故事/分集细纲来做结尾衔接，不要引用或复述下一${unitLabel}已经写好的正文，也不要提前展开下一${unitLabel}的具体事件。
生成完第${unitNumber}${unitLabel}后立刻停止。${nextStoryBridge}`,
      chapterNumber: unitNumber,
      unitCount: 1,
      previousEnding: effectivePreviousEnding || undefined,
      savedMicroStories: microStoriesToUse,
      mode: writerMode,
      ...writerModelRequest,
      actionFirstScript: isMicrodrama ? actionFirstScript : undefined,
      targetEpisodeWords: isMicrodrama ? normalizeTargetEpisodeWords(targetEpisodeWords) : undefined,
      targetNovelWords: !isMicrodrama ? normalizeTargetNovelWords(targetNovelWords) : undefined,
      generatedChapters: undefined,
      nextExistingChapterNumber: undefined,
      nextExistingChapterContent: undefined,
    });

    const requestId = prepareResponse.requestId;
    const eventSource = blueprintApi.generateChapterStream(requestId);
    registerGenerationRequest(requestId, eventSource);

    return new Promise((resolve, reject) => {
      let completedContent = '';
      let lastSseEventAt = Date.now();
      let settled = false;
      let sseErrorTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (sseErrorTimer) clearTimeout(sseErrorTimer);
        eventSource.close();
        releaseGenerationRequest(requestId, eventSource);
      };

      eventSource.onmessage = (event) => {
        try {
          lastSseEventAt = Date.now();
          if (sseErrorTimer) {
            clearTimeout(sseErrorTimer);
            sseErrorTimer = null;
          }

          const data = JSON.parse(event.data);
          if (generationCancelledRef.current) {
            cleanup();
            if (!settled) {
              settled = true;
              reject(new Error('生成已被终止'));
            }
            return;
          }

          switch (data.type) {
            case 'ping':
            case 'start':
            case 'story_complete':
              break;

            case 'duplicate_stream':
              cleanup();
              if (!settled) {
                settled = true;
                reject(new Error(data.message || '重复的流式连接已忽略'));
              }
              break;

            case 'story_start': {
              const startedChapter = Number(data.chapter || data.chapters?.[0] || unitNumber);
              if (Number.isFinite(startedChapter)) {
                setGenerationState(prev => ({
                  ...prev,
                  currentGeneratingChapter: startedChapter,
                }));
                if (autoFollowStreamingRef.current) {
                  setCurrentChapter(startedChapter);
                  setJumpToChapter(startedChapter.toString());
                }
              }
              break;
            }

            case 'story_chunk':
              if (data.content) {
                const cleanContent = cleanWriterContent(data.content);
                setGeneratedContent(cleanContent);
                setGenerationState(prev => ({
                  ...prev,
                  currentGeneratingChapter: unitNumber,
                }));
              }
              break;

            case 'chapter_complete':
              if (Number(data.chapter) === unitNumber && data.content) {
                completedContent = cleanWriterContent(data.content);
                persistGeneratedChapters({ [unitNumber]: completedContent });
                setGeneratedContent(completedContent);
                setGenerationState(prev => ({
                  ...prev,
                  completedChapters: prev.completedChapters.includes(unitNumber)
                    ? prev.completedChapters
                    : [...prev.completedChapters, unitNumber],
                  currentGeneratingChapter: null,
                }));
              }
              break;

            case 'cancelled':
              cleanup();
              if (!settled) {
                settled = true;
                reject(new Error('生成已被终止'));
              }
              break;

            case 'story_error':
              cleanup();
              if (!settled) {
                settled = true;
                reject(new Error(data.error || `第${unitNumber}${unitLabel}生成失败`));
              }
              break;

            case 'complete':
              cleanup();
              if (!settled) {
                settled = true;
                if (completedContent) {
                  resolve(completedContent);
                } else {
                  reject(new Error(`第${unitNumber}${unitLabel}生成结果为空`));
                }
              }
              break;
          }
        } catch (error) {
          cleanup();
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      };

      eventSource.onerror = (error) => {
        if (sseErrorTimer) clearTimeout(sseErrorTimer);
        sseErrorTimer = setTimeout(() => {
          if (Date.now() - lastSseEventAt < SSE_RECONNECT_GRACE_MS) return;
          cleanup();
          if (!settled) {
            settled = true;
            reject(error instanceof Error ? error : new Error(`第${unitNumber}${unitLabel}连接中断`));
          }
        }, SSE_RECONNECT_GRACE_MS);
      };
    });
  };

  const generateSpecificUnits = async (inputText: string) => {
    if (generationLockRef.current || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating) {
      console.warn('已有正文生成任务正在运行，忽略指定章/集补写请求');
      return;
    }
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    const numbers = parseSpecificUnitNumbers(inputText);
    if (numbers.length === 0) {
      alert(`请输入要补写的${unitLabel}编号，例如：30 或 41-43`);
      return;
    }

    const unavailableNumbers = numbers.filter(number => !availableChapterNumberSet.has(number));
    if (availableChapterNumberSet.size > 0 && unavailableNumbers.length > 0) {
      alert(`以下${unitLabel}没有对应细纲，不能补写：${unavailableNumbers.join(', ')}`);
      return;
    }

    const existingNumbers = numbers.filter(number => Boolean(getActiveGeneratedChapters()[number]));
    if (existingNumbers.length > 0) {
      const confirmed = confirm(
        `第 ${existingNumbers.join(', ')} ${unitLabel}已有正文。继续会覆盖这些${unitLabel}，确定要重新生成吗？`
      );
      if (!confirmed) return;
    }

    generationLockRef.current = true;
    generationCancelledRef.current = false;
    setIsSingleUnitGenerating(true);
    enableStreamingFollow();

    try {
      let accumulatedChapters: {[key: number]: string} = getActiveGeneratedChapters();
      const completedUnits: number[] = [];

      for (const unitNumber of numbers) {
        if (generationCancelledRef.current) throw new Error('生成已被终止');
        const content = await generateSingleUnitContent(unitNumber, accumulatedChapters, {
          completedUnits,
          total: numbers.length,
        });
        accumulatedChapters = {
          ...accumulatedChapters,
          [unitNumber]: content,
        };
        completedUnits.push(unitNumber);
      }

      const finalChapters = persistGeneratedChapters(accumulatedChapters);
      await simulateSaveContent(finalChapters);
      setGenerationState({
        isGenerating: false,
        currentGeneratingChapter: null,
        totalChapters: 0,
        completedChapters: [],
      });
      alert(`指定${unitLabel}补写完成：${numbers.join(', ')}`);
    } catch (error) {
      console.error(`指定${unitLabel}补写失败:`, error);
      if (!generationCancelledRef.current) {
        alert(error instanceof Error ? error.message : `指定${unitLabel}补写失败，请稍后重试`);
      }
      setGenerationState({
        isGenerating: false,
        currentGeneratingChapter: null,
        totalChapters: 0,
        completedChapters: [],
      });
    } finally {
      setIsSingleUnitGenerating(false);
      setIsBatchGenerating(false);
      generationLockRef.current = false;
    }
  };

  // 从指定章节开始生成后续内容（支持覆盖模式）
  const generateFromChapter = async (startChapter: number, isOverwriteMode: boolean = false) => {
    if (generationLockRef.current || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating) {
      console.warn('已有正文生成任务正在运行，忽略从指定章节开始生成请求');
      return;
    }
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }

    const microStoriesToUse = microStoriesInOrder;
    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      alert(`没有找到保存的${isMicrodrama ? '分集' : '小故事'}，请先在情节结构细化页面生成并保存${isMicrodrama ? '分集' : '小故事'}`);
      return;
    }

    const totalChapters = isMicrodrama
      ? microStoriesToUse.length * unitsPerMicroStory
      : maxAvailableChapter;

    // 检查起始章节是否有效
    if (startChapter < 1 || startChapter > totalChapters) {
      alert(`起始${unitLabel}无效。可用范围：第1-${totalChapters}${unitLabel}`);
      return;
    }

    // 如果是覆盖模式，给用户确认提示
    if (isOverwriteMode && Object.keys(generatedChapters).length > 0) {
      const hasContentAfterStart = Object.keys(generatedChapters).some(chapter => parseInt(chapter) >= startChapter);
      if (hasContentAfterStart) {
        const confirmed = confirm(`⚠️ 覆盖模式确认\n\n从第${startChapter}${unitLabel}开始重新生成将覆盖现有的正文内容。\n\n这将删除第${startChapter}${unitLabel}及之后的所有已生成内容，然后重新生成。\n\n确定要继续吗？`);
        if (!confirmed) return;
      }
    }

    // 计算还需要生成多少章
    const remainingChapters = totalChapters - startChapter + 1;
    if (remainingChapters <= 0) {
      alert('所有章节都已生成完毕！');
      return;
    }

    const totalBatches = Math.ceil(remainingChapters / unitsPerBatch);

    const modeText = isOverwriteMode ? '重新生成' : '继续生成';
    console.log(`从第${startChapter}章开始${modeText}，共需生成 ${remainingChapters} 个章节，分为 ${totalBatches} 批次`);

    setIsFullCycleGenerating(true);
    setFullCycleProgress({
      current: 0,
      total: remainingChapters,
      currentBatch: 1,
      totalBatches,
      message: `准备从第${startChapter}${unitLabel}开始${modeText}...`
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
        const batchEndChapter = Math.min(batchStartChapter + (unitsPerBatch - 1), totalChapters);
        const batchChapterCount = batchEndChapter - batchStartChapter + 1;

        setFullCycleProgress({
          current: totalGeneratedSoFar - (startChapter - 1),
          total: remainingChapters,
          currentBatch,
          totalBatches,
          message: `正在${modeText}第${currentBatch}批 (${unitLabel} ${batchStartChapter}-${batchEndChapter})...`
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
        alert(`从第${startChapter}${unitLabel}开始${modeText}完成！共生成 ${remainingChapters} 个${unitLabel}内容。`);
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
    if (!isMicrodrama) {
      await generateSegmentParallelContent({ requestedLaneCount: parallelLaneCount });
      return;
    }
    if (generationLockRef.current || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating) {
      console.warn('已有正文生成任务正在运行，忽略新的一键循环生成请求');
      return;
    }
    generationLockRef.current = true;
    generationCancelledRef.current = false;

    if (!currentProject) {
      generationLockRef.current = false;
      alert('未找到当前项目');
      return;
    }

    const microStoriesToUse = microStoriesInOrder;

    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      generationLockRef.current = false;
      alert(`没有找到保存的${isMicrodrama ? '分集' : '小故事'}，请先在情节结构细化页面生成并保存${isMicrodrama ? '分集' : '小故事'}`);
      return;
    }

    const totalChapters = isMicrodrama
      ? microStoriesToUse.length * unitsPerMicroStory
      : maxAvailableChapter;
    const startChapter = getNextChapterToGenerate();
    if (startChapter > totalChapters) {
      generationLockRef.current = false;
      alert(`当前项目已经写到第${getLastGeneratedChapterNumber()}${unitLabel}，没有可继续生成的${unitLabel}。`);
      return;
    }

    const remainingChapters = totalChapters - startChapter + 1;
    const totalBatches = Math.ceil(remainingChapters / unitsPerBatch);

    console.log(`开始一键循环生成，共 ${microStoriesToUse.length} 个${isMicrodrama ? '分集' : '小故事'}，从第${startChapter}${unitLabel}续写，剩余 ${remainingChapters} 个${unitLabel}，分为 ${totalBatches} 批次`);

    setIsFullCycleGenerating(true);
    setFullCycleProgress({
      current: 0,
      total: remainingChapters,
      currentBatch: 1,
      totalBatches,
      message: `准备从第${startChapter}${unitLabel}继续生成...`
    });

    try {
      // 【关键修复】使用本地变量跟踪已生成的章节数和内容，避免依赖异步React状态
      let totalGeneratedSoFar = startChapter - 1;
      let currentBatch = 1;
      let accumulatedChapters: {[key: number]: string} = getActiveGeneratedChapters(); // 累积所有生成的章节

      // 循环生成每一批内容
      while (currentBatch <= totalBatches) {
        if (generationCancelledRef.current) {
          throw new Error('生成已被终止');
        }

        // 【关键】使用本地变量而非异步状态来计算批次信息
        const batchStartChapter = totalGeneratedSoFar + 1;
        const batchEndChapter = Math.min(batchStartChapter + (unitsPerBatch - 1), totalChapters);

        setFullCycleProgress({
          current: totalGeneratedSoFar - (startChapter - 1),
          total: remainingChapters,
          currentBatch,
          totalBatches,
          message: `正在生成第${currentBatch}批 (${unitLabel} ${batchStartChapter}-${batchEndChapter})...`
        });

        console.log(`模拟用户点击：开始生成第${currentBatch}批：章节 ${batchStartChapter}-${batchEndChapter}`);

        // 模拟用户点击"批量生成"按钮 - 等待完成
        // 【关键】传入正确的起始章节、章节数量和累积的章节数据，避免函数内部依赖异步状态
        const batchChapterCount = batchEndChapter - batchStartChapter + 1;
        const batchResult = await simulateBatchGeneration(batchStartChapter, batchChapterCount, accumulatedChapters);
        if (generationCancelledRef.current) {
          throw new Error('生成已被终止');
        }

        // 更新累积的章节数据
        accumulatedChapters = { ...batchResult };

        // 【关键】更新本地跟踪变量，而不是依赖异步状态
        const batchSize = batchEndChapter - batchStartChapter + 1;
        totalGeneratedSoFar += batchSize;

        // 更新累积的章节数据（这里需要等待实际的章节生成完成后再更新，暂时保持现状）

        console.log(`第${currentBatch}批完成，累计生成 ${totalGeneratedSoFar}/${totalChapters} ${unitLabel}`);

        // 继续下一批
        currentBatch++;
      }

      // 全部完成
      await simulateSaveContent(accumulatedChapters);
      await simulateDownloadTXT(accumulatedChapters);
      if (localStorage.getItem('story-architect-auto-export-json') === 'true') {
        simulateDownloadProjectJson(accumulatedChapters);
        localStorage.removeItem('story-architect-auto-export-json');
      }

      setFullCycleProgress({
        current: remainingChapters,
        total: remainingChapters,
        currentBatch: totalBatches,
        totalBatches,
        message: '所有章节生成完成！'
      });

      // 延迟显示完成消息
      setTimeout(() => {
        alert(`全流程自动化生成完成！本次从第${startChapter}${unitLabel}起共生成 ${remainingChapters} 个${unitLabel}内容。`);
        setIsFullCycleGenerating(false);
        setFullCycleProgress(null);

        // 结束整个自动化流程
        if (setIsAutoFlowRunning) setIsAutoFlowRunning(false);
        if (setAutoFlowStep) setAutoFlowStep('全流程自动化生成完成！');
        generationLockRef.current = false;
      }, 1000);

    } catch (error) {
      console.error('一键循环生成失败:', error);
      if (!generationCancelledRef.current) {
        alert('生成过程中出现错误，请稍后重试');
      }
      setIsFullCycleGenerating(false);
      setFullCycleProgress(null);
      generationLockRef.current = false;
    }
  };

  const buildSegmentLanes = (
    totalChapters: number,
    laneCount: number,
    chapters: {[key: number]: string},
    availableChapters: Set<number> = new Set(Array.from({ length: totalChapters }, (_unused, offset) => offset + 1)),
    startChapter: number = 1,
  ) => {
    const segmentSize = 15;
    const normalizedStart = Math.min(totalChapters, Math.max(1, Math.floor(startChapter || 1)));
    const possibleLaneCount = Math.ceil(Math.max(0, totalChapters - normalizedStart + 1) / segmentSize);
    const normalizedLaneCount = Math.min(Math.max(1, laneCount), Math.max(1, possibleLaneCount));

    return Array.from({ length: normalizedLaneCount }, (_, index) => {
      const start = normalizedStart + index * segmentSize;
      const end = Math.min(totalChapters, start + segmentSize - 1);
      const remaining = Array.from({ length: end - start + 1 }, (_unused, offset) => start + offset)
        .filter(chapter => availableChapters.has(chapter) && !chapters[chapter]);

      return {
        id: index + 1,
        start,
        end,
        current: null as number | null,
        completed: 0,
        total: remaining.length,
        status: remaining.length > 0 ? 'pending' as const : 'completed' as const,
      };
    });
  };

  const getSegmentAvailableRanges = (
    start: number,
    end: number,
    chapters: {[key: number]: string},
  ): Array<{ start: number; end: number; total: number }> => {
    const numbers = availableChapterNumbers
      .filter(chapter => chapter >= start && chapter <= end && !chapters[chapter])
      .sort((a, b) => a - b);
    const ranges: Array<{ start: number; end: number; total: number }> = [];
    numbers.forEach(chapter => {
      const last = ranges[ranges.length - 1];
      if (last && chapter === last.end + 1) {
        last.end = chapter;
        last.total += 1;
      } else {
        ranges.push({ start: chapter, end: chapter, total: 1 });
      }
    });
    return ranges;
  };

  const updateSegmentLaneProgress = (
    laneId: number,
    patch: Partial<{
      current: number | null;
      completed: number;
      status: 'pending' | 'running' | 'completed' | 'failed';
    }>,
    message?: string,
  ) => {
    setSegmentProgress(prev => {
      if (!prev) return prev;
      const lanes = prev.lanes.map(lane => (
        lane.id === laneId ? { ...lane, ...patch } : lane
      ));
      const completed = lanes.reduce((sum, lane) => sum + lane.completed, 0);
      return {
        ...prev,
        lanes,
        completed,
        message: message || prev.message,
      };
    });
  };

  const generateChapterRangeForSegment = async (
    startChapter: number,
    segmentEndChapter: number,
    laneChapters: {[key: number]: string},
    callbacks?: {
      onChapterStart?: (chapterNumber: number) => void;
      onChapterComplete?: (chapterNumber: number, content: string) => void;
    },
  ): Promise<{[key: number]: string}> => {
    if (!currentProject) throw new Error('未找到当前项目');
    const currentStoryData = getMicroStoryForChapter(startChapter);
    if (!currentStoryData) {
      throw new Error(`第${startChapter}${unitLabel}缺少对应小故事细纲`);
    }

    const unitCount = Math.max(1, segmentEndChapter - startChapter + 1);
    const effectivePreviousEnding =
      startChapter > 1 ? computePreviousEndingFromChapters(laneChapters, startChapter) : '';
    const nextExistingContent = laneChapters[segmentEndChapter + 1]
      ? extractChapterOpening(laneChapters[segmentEndChapter + 1])
      : '';
    const nextStoryData = getMicroStoryForChapter(segmentEndChapter + 1);
    const nextStoryBridge = nextStoryData
      ? `\n\n【下一段入口参考】\n第${segmentEndChapter + 1}${unitLabel}将进入：${nextStoryData.title}\n${String(nextStoryData.content || '').substring(0, 500)}\n\n当前线程只需要在第${segmentEndChapter}${unitLabel}结尾搭好承接入口，不能开始写第${segmentEndChapter + 1}${unitLabel}的具体事件。`
      : '';
    const generationContext = buildGenerationContext(startChapter, unitCount);

    const prepareResponse = await blueprintApi.prepareChapterStream({
      context: `${generationContext}

【15章线程并行生成边界】
当前并行线程固定只负责第${startChapter}-${segmentEndChapter}${unitLabel}，共${unitCount}${unitLabel}。必须按顺序生成这一段内的每一章；生成到第${segmentEndChapter}${unitLabel}后立刻停止，绝对不要继续生成第${segmentEndChapter + 1}${unitLabel}，也不要跨到其他线程。${nextStoryBridge}`,
      chapterNumber: startChapter,
      unitCount,
      previousEnding: effectivePreviousEnding || undefined,
      savedMicroStories: alignedMicroStoriesForWriting,
      mode: writerMode,
      ...writerModelRequest,
      targetNovelWords: normalizeTargetNovelWords(targetNovelWords),
      nextExistingChapterNumber: nextExistingContent ? segmentEndChapter + 1 : undefined,
      nextExistingChapterContent: nextExistingContent || undefined,
      generatedChapters: undefined,
    });

    const requestId = prepareResponse.requestId;
    const eventSource = blueprintApi.generateChapterStream(requestId);
    registerGenerationRequest(requestId, eventSource);

    return new Promise((resolve, reject) => {
      const completedChaptersData: {[key: number]: string} = {};
      let lastSseEventAt = Date.now();
      let settled = false;
      let sseErrorTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (sseErrorTimer) clearTimeout(sseErrorTimer);
        eventSource.close();
        releaseGenerationRequest(requestId, eventSource);
      };

      eventSource.onmessage = (event) => {
        try {
          lastSseEventAt = Date.now();
          if (sseErrorTimer) {
            clearTimeout(sseErrorTimer);
            sseErrorTimer = null;
          }

          const data = JSON.parse(event.data);
          if (generationCancelledRef.current) {
            cleanup();
            if (!settled) {
              settled = true;
              reject(new Error('生成已被终止'));
            }
            return;
          }

          switch (data.type) {
            case 'ping':
            case 'start':
            case 'story_complete':
              break;

            case 'story_start': {
              const startedChapter = Number(data.chapter || data.chapters?.[0]);
              if (Number.isFinite(startedChapter)) {
                callbacks?.onChapterStart?.(startedChapter);
              }
              break;
            }

            case 'story_chunk':
              if (data.chapter === currentChapterRef.current && data.content) {
                setGeneratedContent(cleanWriterContent(data.content));
              }
              break;

            case 'chapter_complete':
              if (data.chapter >= startChapter && data.chapter <= segmentEndChapter && data.content) {
                const chapterNumber = Number(data.chapter);
                const cleanedContent = cleanWriterContent(data.content);
                completedChaptersData[chapterNumber] = cleanedContent;
                callbacks?.onChapterComplete?.(chapterNumber, cleanedContent);
              }
              break;

            case 'cancelled':
              cleanup();
              if (!settled) {
                settled = true;
                reject(new Error('生成已被终止'));
              }
              break;

            case 'story_error':
              cleanup();
              if (!settled) {
                settled = true;
                reject(new Error(data.error || `第${startChapter}-${segmentEndChapter}${unitLabel}生成失败`));
              }
              break;

            case 'complete':
              cleanup();
              if (!settled) {
                settled = true;
                if (Object.keys(completedChaptersData).length > 0) {
                  resolve(completedChaptersData);
                } else {
                  reject(new Error(`第${startChapter}-${segmentEndChapter}${unitLabel}生成结果为空`));
                }
              }
              break;
          }
        } catch (error) {
          cleanup();
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      };

      eventSource.onerror = (error) => {
        if (sseErrorTimer) clearTimeout(sseErrorTimer);
        sseErrorTimer = setTimeout(() => {
          if (Date.now() - lastSseEventAt < SSE_RECONNECT_GRACE_MS) return;
          cleanup();
          if (!settled) {
            settled = true;
            reject(error instanceof Error ? error : new Error(`第${startChapter}-${segmentEndChapter}${unitLabel}连接中断`));
          }
        }, SSE_RECONNECT_GRACE_MS);
      };
    });
  };

  const getSegmentStartChapter = () => {
    const raw = segmentStartChapterInput.trim();
    if (!raw) return 1;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(1, Math.floor(value)), Math.max(1, maxAvailableChapter));
  };

  const generateSegmentParallelContent = async (opts: { skipConfirm?: boolean; requestedLaneCount?: number; startChapter?: number } = {}) => {
    if (isMicrodrama) {
      alert('15章线程并行生成目前只用于网文正文，微短剧继续使用单集生成。');
      return;
    }
    if (generationLockRef.current || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating) {
      console.warn('已有正文生成任务正在运行，忽略新的15章线程并行生成请求');
      return;
    }
    if (!currentProject) {
      alert('未找到当前项目');
      return;
    }
    const microStoriesToUse = microStoriesInOrder;
    if (!microStoriesToUse || microStoriesToUse.length === 0) {
      alert('没有找到保存的小故事，请先在情节结构细化页面生成并保存小故事');
      return;
    }

    const totalChapters = maxAvailableChapter;
    const initialChapters = getActiveGeneratedChapters();
    const requestedLaneCount = opts.requestedLaneCount || parallelLaneCount;
    const startChapter = Math.min(
      totalChapters,
      Math.max(1, Math.floor(opts.startChapter || 1)),
    );
    const lanes = buildSegmentLanes(totalChapters, requestedLaneCount, initialChapters, availableChapterNumberSet, startChapter);
    const remainingTotal = lanes.reduce((sum, lane) => sum + lane.total, 0);
    if (remainingTotal <= 0) {
      alert(`从第${startChapter}${unitLabel}开始的并行区段都已生成完毕。`);
      return;
    }

    if (!opts.skipConfirm) {
      const confirmed = confirm(
        `将从第${startChapter}${unitLabel}开始，按${requestedLaneCount}线程并行静默生成，当前拆成${lanes.length}个15章区段，共补写 ${remainingTotal} 章。\n\n每个区段只负责自己的15章范围，例如第${startChapter}-${Math.min(totalChapters, startChapter + 14)}${unitLabel}写完后不会越界写下一段。确定继续吗？`
      );
      if (!confirmed) return;
    }

    generationLockRef.current = true;
    generationCancelledRef.current = false;
    pauseStreamingFollow();
    setIsSegmentGenerating(true);
    setSegmentProgress({
      lanes,
      requestedLaneCount,
      completed: 0,
      total: remainingTotal,
      message: `正在从第${startChapter}${unitLabel}启动${requestedLaneCount}线程并行生成，当前拆成${lanes.length}个15章区段...`,
    });
    setGenerationState({
      isGenerating: true,
      currentGeneratingChapter: null,
      totalChapters: remainingTotal,
      completedChapters: [],
    });

    try {
      const laneWorkers = lanes.map(async (lane) => {
        try {
          if (lane.total <= 0) return;
          if (generationCancelledRef.current) throw new Error('生成已被终止');

          const chaptersForContinuity = {
            ...getActiveGeneratedChapters(),
            ...generatedChaptersRef.current,
          };
          const ranges = getSegmentAvailableRanges(lane.start, lane.end, chaptersForContinuity);
          if (ranges.length === 0) {
            updateSegmentLaneProgress(lane.id, {
              current: null,
              completed: 0,
              status: 'completed',
            }, `第${lane.id}条线程无需补写`);
            return;
          }

          updateSegmentLaneProgress(lane.id, {
            current: ranges[0].start,
            status: 'running',
            completed: 0,
          }, `第${lane.id}条线程正在生成第${ranges[0].start}-${ranges[0].end}${unitLabel}`);

          const laneGenerated: {[key: number]: string} = {};
          let laneCompleted = 0;
          const committedChapters = new Set<number>();
          for (const range of ranges) {
            if (generationCancelledRef.current) throw new Error('生成已被终止');
            const latestChaptersForContinuity = {
              ...getActiveGeneratedChapters(),
              ...generatedChaptersRef.current,
              ...laneGenerated,
            };
            updateSegmentLaneProgress(lane.id, {
              current: range.start,
              status: 'running',
              completed: laneCompleted,
            }, `第${lane.id}条线程正在生成第${range.start}-${range.end}${unitLabel}`);
            const commitSegmentChapter = (chapterNumber: number, content: string) => {
              if (committedChapters.has(chapterNumber)) return;
              committedChapters.add(chapterNumber);
              laneGenerated[chapterNumber] = content;
              laneCompleted = Object.keys(laneGenerated).length;
              const updatedChapters = persistGeneratedChapters({ [chapterNumber]: content });
              generatedChaptersRef.current = updatedChapters;
              setGenerationState(prev => ({
                ...prev,
                completedChapters: prev.completedChapters.includes(chapterNumber)
                  ? prev.completedChapters
                  : [...prev.completedChapters, chapterNumber],
              }));
              if (chapterNumber === currentChapterRef.current) {
                setGeneratedContent(content);
              }
              const nextChapterInRange = availableChapterNumbers.find(chapter =>
                chapter > chapterNumber &&
                chapter <= range.end &&
                !committedChapters.has(chapter)
              );
              updateSegmentLaneProgress(lane.id, {
                current: nextChapterInRange || chapterNumber,
                completed: laneCompleted,
                status: 'running',
              }, `第${lane.id}条线程已完成第${chapterNumber}${unitLabel}`);
            };
            const generatedRange = await generateChapterRangeForSegment(
              range.start,
              range.end,
              latestChaptersForContinuity,
              {
                onChapterStart: (chapterNumber) => {
                  updateSegmentLaneProgress(lane.id, {
                    current: chapterNumber,
                    completed: laneCompleted,
                    status: 'running',
                  }, `第${lane.id}条线程正在生成第${chapterNumber}${unitLabel}`);
                },
                onChapterComplete: commitSegmentChapter,
              },
            );
            Object.entries(generatedRange).forEach(([chapterNumberText, content]) => {
              commitSegmentChapter(Number(chapterNumberText), content);
            });
            updateSegmentLaneProgress(lane.id, {
              current: range.end,
              completed: laneCompleted,
              status: 'running',
            }, `第${lane.id}条线程已完成第${range.start}-${range.end}${unitLabel}`);
          }

          const generatedNumbers = Object.keys(laneGenerated).map(Number).sort((a, b) => a - b);

          if (laneGenerated[currentChapterRef.current]) {
            setGeneratedContent(laneGenerated[currentChapterRef.current]);
          }

          updateSegmentLaneProgress(lane.id, {
            current: null,
            completed: generatedNumbers.length,
            status: 'completed',
          }, `第${lane.id}条线程已完成（${lane.start}-${lane.end}）`);
        } catch (error) {
          updateSegmentLaneProgress(lane.id, {
            current: null,
            status: 'failed',
          }, `第${lane.id}条线程中断，已完成章节已保存`);
          throw error;
        }
      });

      const laneResults = await Promise.allSettled(laneWorkers);
      if (generationCancelledRef.current) throw new Error('生成已被终止');

      const finalChapters = getActiveGeneratedChapters(generatedChaptersRef.current);
      await simulateSaveContent(finalChapters);
      const failedCount = laneResults.filter(result => result.status === 'rejected').length;
      const completedNow = getGeneratedChapterNumbers(finalChapters).filter(chapter =>
        availableChapterNumberSet.has(chapter)
      ).length;
      const progressMessage = failedCount > 0
        ? `${requestedLaneCount}线程并行生成已保存已完成章节；${failedCount}个区段中断，可再次点击继续补空白章节。`
        : `${requestedLaneCount}线程并行生成完成，共补写 ${remainingTotal} 章。`;
      setSegmentProgress(prev => prev ? {
        ...prev,
        completed: Math.min(prev.total, Math.max(prev.completed, completedNow)),
        message: progressMessage,
      } : prev);
      if (failedCount > 0) {
        alert(`${requestedLaneCount}线程并行生成部分区段中断，已完成章节已保存。再次点击会继续补空白章节。`);
      } else {
        alert(`${requestedLaneCount}线程并行生成完成，共补写 ${remainingTotal} 章。`);
      }
    } catch (error) {
      console.error('15章线程并行生成失败:', error);
      if (!generationCancelledRef.current) {
        setSegmentProgress(prev => prev ? {
          ...prev,
          message: '15章线程并行生成中断，已完成章节已保存，可再次点击继续补空白章节。',
        } : prev);
        alert('15章线程并行生成中断，已完成章节已保存，可再次点击继续补空白章节。');
      }
    } finally {
      setIsSegmentGenerating(false);
      setIsBatchGenerating(false);
      setIsFullCycleGenerating(false);
      setGenerationState({
        isGenerating: false,
        currentGeneratingChapter: null,
        totalChapters: 0,
        completedChapters: [],
      });
      generationLockRef.current = false;
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

        const microStoriesToUse = isMicrodrama
          ? (currentProject.selectedMicroStories || microStoriesInOrder)
          : alignedMicroStoriesForWriting;

        if (!microStoriesToUse || microStoriesToUse.length < storiesPerBatch) {
          reject(new Error(`需要至少保存${storiesPerBatch}个${isMicrodrama ? '分集' : '小故事'}才能进行批量生成`));
          return;
        }

        console.log(`模拟用户：点击批量生成${expectedChapterCount || unitsPerBatch}${unitLabel}按钮`);
        setIsBatchGenerating(true);

        try {
          // 【关键修复】优先使用传入的参数，避免依赖异步状态
          const startChapter = expectedStartChapter || 1;
          const chapterCount = expectedChapterCount || unitsPerBatch;

          const generationContext = buildGenerationContext(startChapter);
          console.log('批量生成上下文长度:', generationContext.length);


          console.log(`模拟用户：开始流式生成${chapterCount}${unitLabel}内容...`);

          // 初始化生成状态
          setGenerationState({
            isGenerating: true,
            currentGeneratingChapter: startChapter,
            totalChapters: chapterCount,
            completedChapters: []
          });

          // 先准备流式请求，获取requestId
          // 【关键修复】不传递generatedChapters，避免后端依赖历史数据重新计算起始点
          const chaptersForContinuity = allGeneratedChapters || generatedChapters;
          const effectivePreviousEnding =
            startChapter > 1 ? computePreviousEndingFromChapters(chaptersForContinuity, startChapter) : '';
          const prepareResponse = await blueprintApi.prepareChapterStream({
            context: generationContext,
            chapterNumber: startChapter,
            unitCount: chapterCount,
	            previousEnding: effectivePreviousEnding || undefined,
	            savedMicroStories: microStoriesToUse,
	            mode: writerMode,
	            ...writerModelRequest,
	            actionFirstScript: isMicrodrama ? actionFirstScript : undefined,
	            targetEpisodeWords: isMicrodrama ? normalizeTargetEpisodeWords(targetEpisodeWords) : undefined,
	            targetNovelWords: !isMicrodrama ? normalizeTargetNovelWords(targetNovelWords) : undefined,
	            generatedChapters: undefined // 总是传递undefined，让后端完全依赖chapterNumber参数
          });

          const requestId = prepareResponse.requestId;
          console.log('模拟用户：获取到requestId:', requestId);

          // 使用SSE进行流式生成
	          const eventSource = blueprintApi.generateChapterStream(requestId);
	          registerGenerationRequest(requestId, eventSource);

	          let generatedChaptersData: {[key: number]: string} = {};
	          let activeStreamingChapter = startChapter;
	          const completedStreamingChapters = new Set<number>();
	          let lastSseEventAt = Date.now();
	          let sseErrorTimer: ReturnType<typeof setTimeout> | null = null;

          // 设置SSE消息处理器
          eventSource.onmessage = (event) => {
            try {
              lastSseEventAt = Date.now();
              if (sseErrorTimer) {
                clearTimeout(sseErrorTimer);
                sseErrorTimer = null;
              }
              const data = JSON.parse(event.data);
              if (generationCancelledRef.current) {
                eventSource.close();
                releaseGenerationRequest(requestId, eventSource);
                reject(new Error('生成已被终止'));
                return;
              }
              console.log('模拟用户：收到SSE消息:', data.type, data.chapter || '');

              switch (data.type) {
                case 'ping':
                  break;

                case 'duplicate_stream':
                  console.warn(data.message || '重复的流式连接已忽略');
                  eventSource.close();
                  releaseGenerationRequest(requestId, eventSource);
                  setIsBatchGenerating(false);
                  reject(new Error('重复的流式连接已忽略'));
                  break;

                case 'start':
                  console.log('模拟用户：开始生成');
                  setGenerationState(prev => ({
                    ...prev,
                    isGenerating: true,
                    totalChapters: chapterCount
                  }));
                  break;

	                case 'story_start':
	                  console.log('模拟用户：开始生成小故事');
	                  activeStreamingChapter = data.chapters[0];
	                  setGenerationState(prev => ({
	                    ...prev,
	                    currentGeneratingChapter: activeStreamingChapter
	                  }));
	                  if (autoFollowStreamingRef.current) {
	                    setCurrentChapter(activeStreamingChapter);
	                    setJumpToChapter(activeStreamingChapter.toString());
	                  }
	                  setGeneratedContent('');
	                  break;

	                case 'story_chunk':
	                  if (data.content) {
	                    const cleanContent = cleanWriterContent(data.content);
	                    const streamingChapter = data.chapter || activeStreamingChapter;
	                    if (completedStreamingChapters.has(streamingChapter)) {
	                      break;
	                    }
	                    activeStreamingChapter = streamingChapter;
	                    if (autoFollowStreamingRef.current) {
	                      setCurrentChapter(streamingChapter);
	                      setJumpToChapter(streamingChapter.toString());
	                    }
	                    setGenerationState(prev => ({
	                      ...prev,
	                      currentGeneratingChapter: streamingChapter
	                    }));
	                    setGeneratedContent(cleanContent);
	                    console.log(`模拟用户：实时更新内容，当前长度: ${cleanContent.length}`);
	                  }
                  break;

                case 'chapter_complete':
                  if (data.content) {
                    const cleanContent = cleanWriterContent(data.content);
                    completedStreamingChapters.add(data.chapter);
                    generatedChaptersData[data.chapter] = cleanContent;

                    // 每章完成立即落库，避免中断或刷新后丢章节
                    persistGeneratedChapters({ [data.chapter]: cleanContent });

                    setGenerationState(prev => ({
                      ...prev,
                      completedChapters: [...prev.completedChapters, data.chapter],
                      currentGeneratingChapter: data.chapter + 1 <= startChapter + chapterCount - 1 ? data.chapter + 1 : null
                    }));

	                    if (data.chapter === activeStreamingChapter) {
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
                  releaseGenerationRequest(requestId, eventSource);
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
                    const updatedChapters = persistGeneratedChapters({
                      ...(allGeneratedChapters || {}),
                      ...generatedChaptersData,
                    });

                    // 重置生成状态
                    const totalGenerated = Object.keys(updatedChapters).length;
                    setGenerationState({
                      isGenerating: false,
                      currentGeneratingChapter: null,
                      totalChapters: 0,
                      completedChapters: []
                    });

                    console.log(`模拟用户：批量生成完成！共生成了${totalGenerated}个章节的内容`);

                    // 每批完成后先自动保存，最终整轮结束时再统一导出文件。
                    console.log('模拟用户：自动保存内容，包含所有历史章节');
                    simulateSaveContent(updatedChapters);

                    console.log('模拟用户：完成本批次保存，准备继续下一批');

                    eventSource.close();
                    if (sseErrorTimer) clearTimeout(sseErrorTimer);
                    releaseGenerationRequest(requestId, eventSource);
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
            console.warn('模拟用户：SSE连接暂时中断，等待浏览器自动重连:', error);
            if (sseErrorTimer) clearTimeout(sseErrorTimer);
            sseErrorTimer = setTimeout(() => {
              if (Date.now() - lastSseEventAt < SSE_RECONNECT_GRACE_MS) return;
              console.error('模拟用户：SSE连接超过180秒没有恢复');
              setIsBatchGenerating(false);
              releaseGenerationRequest(requestId, eventSource);
              reject(error);
            }, SSE_RECONNECT_GRACE_MS);
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

  const simulateDownloadProjectJson = (chaptersToExport?: {[key: number]: string}) => {
    try {
      if (!currentProject) {
        console.log('模拟用户：没有项目可导出JSON');
        return;
      }

      const chapters = chaptersToExport || generatedChapters;
      const updatedProject = {
        ...currentProject,
        generatedChapters: { ...chapters },
        updatedAt: new Date().toISOString(),
      };

      exportProject(updatedProject);
      console.log('模拟用户：项目JSON总文件已自动导出');
    } catch (error) {
      console.error('模拟用户：自动导出项目JSON失败:', error);
    }
  };

  const buildGenerationContext = (currentBatchStartChapter?: number, contextUnitCount = unitsPerBatch): string => {
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
	      if (isLiterature || currentProject.outline.requiresSpecialPower !== false) {
	        context += `${isLiterature ? '文学核心' : '金手指设定'}：${currentProject.outline.themes}\n`;
	      }
	      context += '\n';
	    }

	    if (isLiterature) {
	      const styleName = literatureStyleNames[currentProject.literatureWritingStyle || ''] || '现实主义白描';
	      context += `【文学作品正文模式】\n`;
	      context += `文风选择：${styleName}\n`;
	      context += `写作要求：这是文学作品，不按网文章节爽点写法处理；不要金手指、系统、外挂、升级、打脸爽点、强钩子和过度情绪拉扯。正文以正常叙事讲清故事，以人物刻画、生活细节、关系变化、环境压力和主题余韵为核心。小节细纲属于同一大章内部段落，写作时要保留“第X章 / 第X小节”的层次感。\n\n`;
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
      context += isMicrodrama ? '【核心人物资料优先摘要】\n' : '【人物设定】\n';
      const charactersSummary = buildFocusedCharacterContext(currentProject.characters, isMicrodrama);
      context += charactersSummary + '\n\n';
    }

    // 详细情节细纲 - 精简到相关部分
    if (currentProject.detailedOutline) {
      context += '【情节架构】\n';
      // 只保留前600字符的架构概述
      const outlineSummary = currentProject.detailedOutline.substring(0, 600);
      context += outlineSummary + (currentProject.detailedOutline.length > 600 ? '...' : '') + '\n\n';
    }

    // 当前批次相关的小故事/分集细纲
    if (microStoriesInOrder && microStoriesInOrder.length > 0) {
      const startChapter = currentBatchStartChapter || 1;
      const unitsInContext = Math.max(1, contextUnitCount);
      const endChapter = startChapter + unitsInContext - 1;
      const relevantStories = chapterStoryEntries.filter(entry =>
        entry.chapterNumber >= startChapter && entry.chapterNumber <= endChapter
      );

      if (relevantStories.length > 0) {
	        context += `【本批次${isMicrodrama ? '分集' : isLiterature ? '小节' : '小故事'}细纲】\n`;
        relevantStories.forEach(({ story, chapterNumber }, index) => {
	          const rangeText = isMicrodrama
	            ? `第${chapterNumber}集`
	            : isLiterature
	              ? story.title
	              : `第${chapterNumber}章`;
	          context += `${isMicrodrama ? '分集' : isLiterature ? '小节' : '小故事'}${index + 1}（${rangeText}）：\n`;
          context += `标题：${story.title}\n`;
          context += `内容：${story.content}\n\n`;
        });
      }
    }

    // 特别强调当前章节/当前集对应的剧情边界
    if (microStoriesInOrder && microStoriesInOrder.length > 0) {
      const currentStoryChapter = currentBatchStartChapter || currentChapter;
      const currentStory = getMicroStoryForChapter(currentStoryChapter);

      if (currentStory) {
	        context += `【当前${unitLabel === '集' ? '单集' : isLiterature ? '小节' : '章节'}剧情边界参考】\n`;
        context += isMicrodrama
          ? `当前集：第${currentStoryChapter}集\n`
	          : isLiterature
	            ? `当前小节：${currentStory.title}\n`
	            : `章节：第${currentStoryChapter}章\n`;
	        context += `对应${isMicrodrama ? '分集' : isLiterature ? '小节' : '小故事'}：${currentStory.title}\n`;
	        context += `${isMicrodrama ? '分集' : isLiterature ? '小节' : '小故事'}详细内容：${currentStory.content}\n`;
        context += `所属中故事：${currentStory.macroStoryTitle}\n\n`;
	        context += `重要提示：请严格按照上述${isMicrodrama ? '分集' : isLiterature ? '小节' : '小故事'}内容进行创作，确保正文与剧情边界吻合；正文中不得出现“小故事卡”“技法卡”“一级结构”“阶段状态小结”等创作后台信息。\n\n`;
      }
    }

    return context;
  };

  const navigateChapter = (direction: 'prev' | 'next') => {
    if (!confirmDiscardChapterEdits()) return;
    pauseStreamingFollow();

    if (direction === 'prev') {
      const currentGroupStart = currentChapter;
      const prevGroupStart = currentGroupStart - unitsPerMicroStory;

      if (prevGroupStart >= 1) {
        const bestPrev = getBestExistingChapterInGroup(prevGroupStart);
        if (bestPrev === null) return;
        setIsEditingChapter(false);
        setChapterDraftTouched(false);
        setCurrentChapter(bestPrev);
        setGeneratedContent(generatedChapters[bestPrev] || '');
        setJumpToChapter(bestPrev.toString());
      }
    } else if (direction === 'next') {
      const currentGroupStart = currentChapter;
      const nextGroupStart = currentGroupStart + unitsPerMicroStory;

      const bestNext = getBestExistingChapterInGroup(nextGroupStart);
      if (bestNext !== null) {
        setIsEditingChapter(false);
        setChapterDraftTouched(false);
        setCurrentChapter(bestNext);
        setGeneratedContent(generatedChapters[bestNext] || '');
        setJumpToChapter(bestNext.toString());

        // 如果下一章正在生成中，实时内容会通过SSE更新
        if (generationState.currentGeneratingChapter === bestNext) {
          // 内容会通过SSE实时更新，不需要手动设置
        }
      }
    }
  };

  const saveChapter = (opts?: { silent?: boolean }) => {
    if (!currentProject) return;
    const contentToSave = visibleChapterContent;
    if (!contentToSave) {
      if (!opts?.silent) alert('当前章节没有内容可保存');
      return;
    }

    const updatedChapters = { ...generatedChapters, [currentChapter]: contentToSave };
    setGeneratedChapters(updatedChapters);
    setGeneratedContent(contentToSave);

    // 落库到项目：后续引用/生成会以这里的最新正文为准
    updateProject(currentProject.id, {
      generatedChapters: updatedChapters,
    });

    setIsEditingChapter(false);
    setChapterDraftTouched(false);
    pendingEditScrollYRef.current = window.scrollY;

    if (!opts?.silent) alert(`第${currentChapter}${unitLabel}内容已保存（已更新为最新文档）。`);
  };

  const startEditChapter = () => {
    if (generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating || isRewritingChapter) return;
    pendingEditScrollYRef.current = window.scrollY;
    setIsEditingChapter(true);
    setChapterDraft(generatedChapters[currentChapter] ?? generatedContent ?? '');
    setChapterDraftTouched(false);
  };

  const cancelEditChapter = () => {
    pendingEditScrollYRef.current = window.scrollY;
    setIsEditingChapter(false);
    setChapterDraft(generatedChapters[currentChapter] ?? generatedContent ?? '');
    setChapterDraftTouched(false);
  };

  const clearCurrentChapter = () => {
    if (!currentProject) return;
    if (generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating || isRewritingChapter) return;

    const currentContent = visibleChapterContent;
    if (!currentContent) {
      alert('当前章节没有可清空的内容');
      return;
    }

    const confirmed = confirm(`确定要清空第${currentChapter}${unitLabel}内容吗？清空后可重新生成该${unitLabel}。`);
    if (!confirmed) return;

    const updatedChapters = { ...generatedChapters };
    delete updatedChapters[currentChapter];

    setGeneratedChapters(updatedChapters);
    setGeneratedContent('');
    setIsEditingChapter(false);
    setChapterDraft('');
    setChapterDraftTouched(false);

    updateProject(currentProject.id, {
      generatedChapters: updatedChapters,
    });

    alert(`第${currentChapter}${unitLabel}已清空，你可以重新生成该${unitLabel}。`);
  };

  const rewriteCurrentChapterLength = async () => {
    if (!currentProject) return;
    if (isEditingChapter || generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isSingleUnitGenerating || isRewritingChapter) return;

    const currentContent = visibleChapterContent;
    if (!currentContent) {
      alert(`当前${unitLabel}没有可重写的内容`);
      return;
    }
    if (rewritePercent === 0) {
      alert('请先拖动滑块选择压缩或膨胀比例');
      return;
    }

    const storyData = getMicroStoryForChapter(currentChapter);
    const directionText = rewritePercent > 0 ? '膨胀' : '压缩';
    const confirmed = confirm(
      `将把第${currentChapter}${unitLabel}按当前内容重新${directionText} ${Math.abs(rewritePercent)}%，目标约 ${rewriteTargetWords} 字。\n\n重写结果会覆盖当前${unitLabel}正文，确定继续吗？`
    );
    if (!confirmed) return;

    setIsRewritingChapter(true);
    try {
      const response = await blueprintApi.rewriteChapter({
        content: currentContent,
        chapterNumber: currentChapter,
        targetWords: rewriteTargetWords,
        adjustmentPercent: rewritePercent,
        context: buildGenerationContext(currentChapter),
        storyData,
        ...writerModelRequest,
        actionFirstScript: isMicrodrama ? actionFirstScript : undefined,
        mode: writerMode,
      });

      if (!response.success || !response.data) {
        throw new Error('重写结果为空');
      }

      const rewrittenContent = cleanWriterContent(response.data);
      const updatedChapters = { ...generatedChapters, [currentChapter]: rewrittenContent };
      setGeneratedChapters(updatedChapters);
      setGeneratedContent(rewrittenContent);
      updateProject(currentProject.id, {
        generatedChapters: updatedChapters,
      });
      alert(`第${currentChapter}${unitLabel}已重写完成，当前约 ${getWordCount(rewrittenContent)} 字。`);
    } catch (error) {
      console.error(`重写当前${unitLabel}失败:`, error);
      alert('重写失败，请稍后重试');
    } finally {
      setIsRewritingChapter(false);
    }
  };

  const reviewAndReviseMicrodramaScripts = async () => {
    if (!currentProject || !isMicrodrama) return;
    if (isEditingChapter || hasActiveGeneration || isRewritingChapter) return;

    const chapterCount = Object.keys(generatedChapters).length;
    if (chapterCount === 0) {
      alert('请先生成微短剧剧本正文，再进行全剧审读修订');
      return;
    }

    const confirmed = confirm(
      `将用 GPT-5.5 对已生成的 ${chapterCount} 集微短剧做整体审读和补丁式修订。\n\n重点会检查剧情一致性、反派贯穿、人物弧光，并重点打磨主角和主要配角台词，让台词更符合人设、更有记忆点和金句感。修订会直接覆盖可安全替换的小段内容，确定继续吗？`
    );
    if (!confirmed) return;

    setIsReviewingScripts(true);
    try {
      const response = await blueprintApi.reviewMicrodramaScripts({
        chapters: generatedChapters,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        savedMicroStories: currentProject.savedMicroStories,
        model: 'gpt-5.5',
      });

      if (!response.success || !response.data?.updatedChapters) {
        throw new Error('审读修订结果为空');
      }

      const updatedChapters = Object.fromEntries(
        Object.entries(response.data.updatedChapters).map(([episode, content]) => [Number(episode), cleanWriterContent(String(content || ''))])
      );
      setGeneratedChapters(updatedChapters);
      generatedChaptersRef.current = updatedChapters;
      setGeneratedContent(updatedChapters[currentChapter] || generatedContent);
      updateProject(currentProject.id, {
        generatedChapters: updatedChapters,
      });

      const applied = response.data.appliedPatches?.length || 0;
      const skipped = response.data.skippedPatches?.length || 0;
      const issues = response.data.issues?.length || 0;
      const compressed = response.data.compressedEpisodes?.length || 0;
      alert(`全剧审读修订完成。\n发现问题：${issues}处\n已自动应用补丁：${applied}处\n超长单集压缩：${compressed}集\n需人工确认/未能定位：${skipped}处\n\n${response.data.summary || ''}`);
    } catch (error) {
      console.error('微短剧全剧审读修订失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '微短剧全剧审读修订失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsReviewingScripts(false);
    }
  };

  const exportChapter = () => {
    // 导出章节内容
    const contentToExport = visibleChapterContent;
    const data = `第${currentChapter}${unitLabel}\n\n${contentToExport}`;
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
    <div
      className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100"
      onWheelCapture={(event) => {
        if (!generationState.isGenerating) return;
        if (event.deltaY < 0) {
          pauseStreamingFollow();
          return;
        }
        window.setTimeout(() => {
          if (isNearPageBottom() && currentChapterRef.current === generationState.currentGeneratingChapter) {
            enableStreamingFollow();
          }
        }, 0);
      }}
    >
      {/* Header - 重新设计的紧凑布局 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="w-full px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：返回和标题 */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              <button
                onClick={handleBackWithSaveGuard}
                disabled={hasActiveGeneration}
                className={`p-2 rounded-lg transition-colors ${
                  hasActiveGeneration
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-secondary-100 hover:bg-secondary-200 text-secondary-600'
                }`}
                title={hasActiveGeneration ? '生成过程中无法返回，请等待完成或终止生成' : '返回上一页'}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-blue-100 rounded-lg">
                  <PenTool className="w-4 h-4 text-blue-600" />
                </div>
                <div className="hidden sm:block">
                  <h1 className="text-base font-bold text-secondary-900">{isMicrodrama ? '剧本写作工作室' : '正文写作工作室'}</h1>
                  <p className="text-xs text-secondary-600">{isMicrodrama ? '基于分集细纲创作微短剧单集正文' : '基于完整故事架构进行创作'}</p>
                </div>
                <div className="sm:hidden">
                  <h1 className="text-sm font-bold text-secondary-900">{isMicrodrama ? '剧本写作' : '写作工作室'}</h1>
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
                    {isSegmentGenerating ? (
                      <>
                        <span>15章线程</span>
                        <div className="flex items-center ml-2">
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
                          <span className="ml-1 text-xs text-cyan-700 font-medium">静默生成中</span>
                        </div>
                      </>
                    ) : generationState.isGenerating ? (
                      <>
                        <span>{getUnitRangeDisplay(generationState.currentGeneratingChapter || 1)}</span>
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
                        <span>{getUnitRangeDisplay(currentChapter)}</span>
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
	                    {Object.keys(generatedChapters).length} {unitLabel}已生成
	                  </span>
	                </div>

	                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white/80 rounded-lg border border-secondary-200">
	                  <span className="text-xs font-medium text-secondary-600">模型</span>
	                  <select
	                    value={writerModelValue}
	                    onChange={(event) => setWriterModelValue(event.target.value)}
	                    disabled={hasActiveGeneration || isRewritingChapter}
	                    className="max-w-[180px] rounded-md border border-secondary-200 bg-white px-2 py-1 text-xs font-medium text-secondary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
	                    title={`当前正文模型：${writerModelOption.label}（${writerModelOption.description}）`}
	                  >
	                    {WRITER_MODEL_OPTIONS.map(option => (
	                      <option key={option.value} value={option.value}>
	                        {option.label} · {option.description}
	                      </option>
	                    ))}
	                  </select>
	                </div>

	                {isMicrodrama && (
	                  <button
	                    type="button"
	                    onClick={() => setActionFirstScript(prev => !prev)}
	                    disabled={generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isRewritingChapter}
	                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:cursor-not-allowed ${
	                      actionFirstScript
	                        ? 'bg-emerald-600 border-emerald-600 text-white'
	                        : 'bg-white/80 border-secondary-200 text-secondary-700 hover:bg-secondary-50 disabled:text-secondary-400'
	                    }`}
	                    title="开启后，微短剧剧本会以动作、镜头和人物行为为主，台词为辅"
	                  >
	                    <PenTool className="w-3.5 h-3.5" />
	                    <span>动作主导</span>
	                  </button>
	                )}
	              </div>

              {/* 章节导航 - 美化版 */}
              <div className="flex items-center space-x-2 bg-white/80 rounded-xl px-4 py-2 border border-secondary-200 shadow-sm">
                <button
                  onClick={() => navigateChapter('prev')}
                  disabled={Object.keys(generatedChapters).length === 0 || (() => {
                    const currentGroupStart = currentChapter;
                    const prevGroupStart = currentGroupStart - unitsPerMicroStory;
                    if (prevGroupStart < 1) return true;
                    return getBestExistingChapterInGroup(prevGroupStart) === null;
                  })()}
                  className="flex items-center justify-center w-8 h-8 bg-secondary-100 hover:bg-secondary-200 disabled:bg-gray-100 disabled:text-gray-400 rounded-lg transition-all duration-200 disabled:cursor-not-allowed hover:shadow-sm"
                  title={isMicrodrama ? '上一集' : '上一章'}
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
                    <span className="text-xs text-secondary-500">{unitLabel}</span>
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
                    const currentGroupStart = currentChapter;
                    const nextGroupStart = currentGroupStart + unitsPerMicroStory;
                    return getBestExistingChapterInGroup(nextGroupStart) === null;
                  })()}
                  className="flex items-center justify-center w-8 h-8 bg-secondary-100 hover:bg-secondary-200 disabled:bg-gray-100 disabled:text-gray-400 rounded-lg transition-all duration-200 disabled:cursor-not-allowed hover:shadow-sm"
                  title={isMicrodrama ? '下一集' : '下一章'}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 右侧：操作按钮面板 */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              {/* 生成控制按钮 */}
              <div className="flex flex-col space-y-2">
                {generationState.isGenerating && generationState.currentGeneratingChapter && (!autoFollowStreaming || currentChapter !== generationState.currentGeneratingChapter) && (
                  <button
                    onClick={followLatestStreamingOutput}
                    className="flex items-center justify-center space-x-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors text-sm"
                    title="回到正在流式输出的章节，并恢复自动跟随"
                  >
                    <ChevronRight className="w-4 h-4" />
                    <span className="hidden sm:inline">跟随最新</span>
                    <span className="sm:hidden">跟随</span>
                  </button>
                )}
                {hasActiveGeneration && (
                  <button
                    onClick={stopGeneration}
                    className="flex items-center space-x-2 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-sm"
                  >
                    <span className="hidden sm:inline">终止生成</span>
                    <span className="sm:hidden">终止</span>
                  </button>
                )}
                {!hasActiveGeneration && Object.keys(generatedChapters).length > 0 && (
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
                  onClick={() => saveGeneratedContent()}
                  disabled={Object.keys(generatedChapters).length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Save className="w-4 h-4" />
                  <span className="hidden sm:inline">保存</span>
                </button>

                <button
                  onClick={saveGeneratedContentAndSyncCloud}
                  disabled={isCloudSyncing || Object.keys(generatedChapters).length === 0}
                  className="flex items-center space-x-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                  title="保存当前正文，并按激活码同步到云端"
                >
                  <RefreshCw className={`w-4 h-4 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{isCloudSyncing ? '同步中' : '云端'}</span>
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
                  onClick={exportAsMarkdown}
                  disabled={Object.keys(generatedChapters).length === 0 || isExportingMarkdown}
                  title={isMicrodrama ? '导出送审 Markdown' : '导出精排 Markdown'}
                  className="flex items-center space-x-2 px-3 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className={`w-4 h-4 ${isExportingMarkdown ? 'animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{isExportingMarkdown ? '生成中' : 'MD'}</span>
                </button>

                <button
                  onClick={exportCurrentProjectJson}
                  disabled={!currentProject}
                  title="导出当前完整项目 JSON"
                  className="flex items-center space-x-2 px-3 py-2 bg-slate-600 hover:bg-slate-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">JSON</span>
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
                    当前{unitLabel}
                  </label>
                  <div className="text-2xl font-bold text-primary-600">
                    {getUnitRangeDisplay(currentChapter)}
                  </div>
                  <div className="text-sm text-secondary-500 mt-1">
                    已生成: {Object.keys(generatedChapters).length} {unitLabel}
                    {generationState.isGenerating && !isSegmentGenerating && (
                      <span className="ml-2 text-orange-600">
                        (第{generationState.currentGeneratingChapter}{unitLabel}进行中...)
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-white/80 border border-secondary-200 rounded-lg">
                  <label className="block text-sm font-medium text-secondary-700 mb-2">
                    正文生成模型
                  </label>
                  <select
                    value={writerModelValue}
                    onChange={(event) => setWriterModelValue(event.target.value)}
                    disabled={hasActiveGeneration || isRewritingChapter}
                    className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {WRITER_MODEL_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label} · {option.description}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-secondary-500">
                    批量生成、单{unitLabel}补写、并行生成和当前{unitLabel}重写都会使用此模型。
                  </p>
                </div>

                <div className="p-3 bg-white/80 border border-secondary-200 rounded-lg">
                  <label className="block text-sm font-medium text-secondary-700 mb-2">
                    每{unitLabel}目标字数
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={isMicrodrama ? 500 : 800}
                      max="5000"
                      step="100"
                      value={isMicrodrama ? targetEpisodeWords : targetNovelWords}
                      onChange={(e) => {
                        if (isMicrodrama) {
                          setTargetEpisodeWords(normalizeTargetEpisodeWords(e.target.value));
                        } else {
                          setTargetNovelWords(normalizeTargetNovelWords(e.target.value));
                        }
                      }}
                      disabled={generationState.isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating}
                      className="w-28 px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                    <span className="text-sm text-secondary-600">字/{unitLabel}</span>
                  </div>
                  <p className="mt-2 text-xs text-secondary-500">
                    生成时以约 {activeTargetWords} 字为目标；网文超过 3000 字会先校验小故事边界并裁剪越界内容，裁剪后仍超再用当前正文模型压缩约 30%。
                  </p>
                </div>

                <div className="p-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-lg space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-violet-900">补写指定{unitLabel}</h4>
                      <p className="text-xs text-violet-700 mt-1">
                        可输入 30 或 41-43；连续空白会按单{unitLabel}逐个生成，只带上一{unitLabel}结尾和下一{unitLabel}细纲。
                      </p>
                    </div>
                    <span className="px-2 py-1 rounded-md bg-white/80 border border-violet-200 text-[11px] font-medium text-violet-700">
                      缺 {availableChapterNumbers.filter(chapter => !generatedChapters[chapter]).length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={specificUnitInput}
                      onChange={(event) => setSpecificUnitInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void generateSpecificUnits(specificUnitInput);
                        }
                      }}
                      placeholder={`如 30, 41-43`}
                      disabled={hasActiveGeneration || isRewritingChapter}
                      className="min-w-0 flex-1 px-3 py-2 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => generateSpecificUnits(specificUnitInput)}
                      disabled={hasActiveGeneration || isRewritingChapter || !specificUnitInput.trim()}
                      className="px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                    >
                      补写
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => generateSpecificUnits(String(currentChapter))}
                    disabled={hasActiveGeneration || isRewritingChapter || !availableChapterNumberSet.has(currentChapter)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-violet-100 disabled:bg-gray-100 disabled:text-gray-400 border border-violet-200 text-violet-800 rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                    title={`只生成当前第${currentChapter}${unitLabel}`}
                  >
                    <PenTool className="w-4 h-4" />
                    <span>只生成当前第{currentChapter}{unitLabel}</span>
                  </button>
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
                          已生成 {Object.keys(generatedChapters).length} {unitLabel}内容，可以选择继续生成或重新生成之前的正文
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
	                    disabled={isBatchGenerating || isGenerating || isFullCycleGenerating || isSegmentGenerating || isRewritingChapter || (() => {
	                      const generatedCount = getGeneratedChapterNumbers().length;
	                      const batchIndex = Math.floor(generatedCount / unitsPerBatch); // 当前是第几批
	                      const requiredStories = (batchIndex + 1) * storiesPerBatch;
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
	                            const generatedCount = getGeneratedChapterNumbers().length;
	                            if (generatedCount === 0) return isMicrodrama ? '生成第1集' : '批量生成8章';
	                            if (generatedCount % unitsPerBatch !== 0) return `继续生成 (${generatedCount % unitsPerBatch}/${unitsPerBatch})`;
	                            return isMicrodrama ? '继续生成下一集' : '继续生成下一批';
	                          })()}
                        </span>
                      </>
                    )}
                  </button>

                  <div className="text-center text-sm text-secondary-500">或</div>

                  <button
                    onClick={generateFullCycleContent}
                    disabled={isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isRewritingChapter || !currentProject?.savedMicroStories?.length}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-semibold transition-all duration-200 disabled:cursor-not-allowed"
                  >
                    {isFullCycleGenerating || isSegmentGenerating ? (
                      <>
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        <span>{isMicrodrama ? '循环生成中...' : '并行生成中...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6" />
                        <span>
                          {microStoriesInOrder?.length
                            ? isMicrodrama
                              ? `一键循环生成 (${microStoriesInOrder.length}集剧本正文)`
                              : `一键并行生成 (${microStoriesInOrder.length}个小故事，最高第${maxAvailableChapter}章)`
                            : '一键循环生成'}
                        </span>
                      </>
                    )}
                  </button>

                  {!isMicrodrama && (
                    <div className="p-3 bg-white/80 border border-secondary-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-secondary-900">15章线程并行生成</div>
                          <div className="text-xs text-secondary-500 mt-1">每条线程写15章，可指定从任意章节作为并行起点</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <label className="inline-flex items-center gap-1 text-xs text-secondary-600">
                            起点第
                            <input
                              type="number"
                              min={1}
                              max={Math.max(1, maxAvailableChapter)}
                              value={segmentStartChapterInput}
                              onChange={(event) => setSegmentStartChapterInput(event.target.value)}
                              disabled={hasActiveGeneration || isRewritingChapter}
                              className="w-20 px-2 py-1.5 border border-secondary-300 rounded-lg text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400"
                              placeholder="1"
                              title="指定5/10线程并行生成从哪一章开始；留空从第1章开始"
                            />
                            章
                          </label>
                          <button
                            type="button"
                            onClick={() => setSegmentStartChapterInput(String(currentChapter))}
                            disabled={hasActiveGeneration || isRewritingChapter}
                            className="px-2 py-1.5 text-xs rounded-lg border border-secondary-200 bg-white hover:bg-secondary-50 disabled:bg-gray-100 disabled:text-gray-400"
                            title="把当前正在查看的章节设为并行起点"
                          >
                            用当前章
                          </button>
                          <select
                            value={parallelLaneCount}
                            onChange={(event) => setParallelLaneCount(Number(event.target.value))}
                            disabled={hasActiveGeneration || isRewritingChapter}
                            className="px-2 py-1.5 border border-secondary-300 rounded-lg text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400"
                            title="选择并行线程数量"
                          >
                            <option value={5}>5线程</option>
                            <option value={10}>10线程</option>
                          </select>
                        </div>
                      </div>
                      <div className="text-xs text-secondary-500 bg-secondary-50 border border-secondary-100 rounded-lg px-3 py-2">
                        当前并行范围预览：第{getSegmentStartChapter()}-{Math.min(maxAvailableChapter || getSegmentStartChapter(), getSegmentStartChapter() + parallelLaneCount * 15 - 1)}章。
                        已写过的章节会自动跳过，只补空白章节。
                      </div>
                      <button
                        onClick={() => generateSegmentParallelContent({ startChapter: getSegmentStartChapter() })}
                        disabled={isGenerating || isBatchGenerating || isFullCycleGenerating || isSegmentGenerating || isRewritingChapter || !currentProject?.savedMicroStories?.length}
                        className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-slate-700 to-cyan-700 hover:from-slate-800 hover:to-cyan-800 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-semibold transition-all duration-200 disabled:cursor-not-allowed"
                      >
                        {isSegmentGenerating ? (
                          <>
                            <RefreshCw className="w-6 h-6 animate-spin" />
                            <span>线程并行中...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-6 h-6" />
                            <span>{parallelLaneCount}线程并行生成</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

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
                            {fullCycleProgress.current}/{fullCycleProgress.total} {unitLabel}
                          </span>
                          {fullCycleProgress.currentChapter && (
                            <div className="flex items-center space-x-2 px-2 py-1 bg-green-100 rounded-md">
                              <span className="text-xs font-medium text-green-800">
                                第{fullCycleProgress.currentChapter}{unitLabel}
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
	                        每生成{unitsPerBatch}{unitLabel}自动保存历史快照 • 共需保存 {fullCycleProgress.totalBatches} 个快照
                      </div>
                    </div>
                  )}

                  {segmentProgress && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-slate-50 to-cyan-50 rounded-lg border border-cyan-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-cyan-500 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-cyan-800">
                            {segmentProgress.completed}/{segmentProgress.total} 章
                          </span>
                        </div>
                        <span className="text-xs text-cyan-700">
                          {segmentProgress.requestedLaneCount}线程并行
                          {segmentProgress.lanes.length !== segmentProgress.requestedLaneCount
                            ? ` · ${segmentProgress.lanes.length}个区段`
                            : ''}
                        </span>
                      </div>

                      <div className="w-full bg-cyan-100 rounded-full h-2 mb-3">
                        <div
                          className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${segmentProgress.total ? (segmentProgress.completed / segmentProgress.total) * 100 : 0}%` }}
                        ></div>
                      </div>

                      <div className="space-y-2">
                        {segmentProgress.lanes.map(lane => (
                          <div key={lane.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-secondary-700">
                              {lane.id}线程 {lane.start}-{lane.end}
                            </span>
                            <span className={
                              lane.status === 'failed'
                                ? 'text-red-600'
                                : lane.status === 'completed'
                                  ? 'text-emerald-700'
                                  : 'text-cyan-700'
                            }>
                              {lane.status === 'completed'
                                ? '完成'
                                : lane.current
                                  ? `第${lane.current}章`
                                  : '等待'} · {lane.completed}/{lane.total}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 text-xs text-cyan-700 text-center">
                        {segmentProgress.message}
                      </div>
                    </div>
                  )}

                </div>

                <div className="p-4 bg-gradient-to-r from-sky-50 to-cyan-50 border border-sky-200 rounded-lg">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-sky-900">当前{unitLabel}字数重写</h4>
                        <p className="text-xs text-sky-700 mt-1">
                          {visibleChapterContent
                            ? `当前约 ${visibleChapterWords} 字，目标约 ${rewriteTargetWords} 字`
                            : `先生成或打开一${unitLabel}正文，再按比例压缩/膨胀`}
                        </p>
                      </div>
                      <div className={`px-2 py-1 rounded-md text-xs font-bold ${
                        rewritePercent > 0
                          ? 'bg-emerald-100 text-emerald-700'
                          : rewritePercent < 0
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-secondary-100 text-secondary-600'
                      }`}>
                        {rewritePercent > 0 ? '+' : ''}{rewritePercent}%
                      </div>
                    </div>

                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="1"
                      value={rewritePercent}
                      onChange={(e) => setRewritePercent(Number(e.target.value))}
                      disabled={
                        !visibleChapterContent ||
                        isEditingChapter ||
                        generationState.isGenerating ||
                        isBatchGenerating ||
                        isFullCycleGenerating ||
                        isSegmentGenerating ||
                        isRewritingChapter
                      }
                      className="w-full accent-sky-600"
                    />
                    <div className="flex justify-between text-[11px] text-sky-700 mt-1">
                      <span>压缩50%</span>
                      <span>不变</span>
                      <span>膨胀50%</span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {[-50, -20, 20, 50].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRewritePercent(value)}
                          disabled={
                            !visibleChapterContent ||
                            isEditingChapter ||
                            generationState.isGenerating ||
                            isBatchGenerating ||
                            isFullCycleGenerating ||
                            isSegmentGenerating ||
                            isRewritingChapter
                          }
                          className="px-2 py-1 bg-white hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400 border border-sky-200 text-sky-800 rounded text-xs font-medium"
                        >
                          {value > 0 ? '+' : ''}{value}%
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={rewriteCurrentChapterLength}
                      disabled={
                        !visibleChapterContent ||
                        isEditingChapter ||
                        generationState.isGenerating ||
                        isBatchGenerating ||
                        isFullCycleGenerating ||
                        isSegmentGenerating ||
                        isRewritingChapter ||
                        rewritePercent === 0
                      }
                      className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRewritingChapter ? 'animate-spin' : ''}`} />
                      <span>
                        {isRewritingChapter
                          ? '重写中...'
                          : visibleChapterContent
                            ? `按比例重写当前${unitLabel}`
                            : `请先生成或打开当前${unitLabel}`}
                      </span>
                    </button>
                  </div>

                  {isMicrodrama && (
                    <div className="p-4 bg-gradient-to-r from-fuchsia-50 to-rose-50 border border-fuchsia-200 rounded-lg">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-fuchsia-900">全剧审读修订</h4>
                          <p className="text-xs text-fuchsia-700 mt-1">
                            GPT-5.5补丁式修订：查剧情一致性、反派贯穿、人物弧光，并重点打磨主角和主要配角台词。
                          </p>
                        </div>
                        <span className="px-2 py-1 rounded-md bg-white/80 border border-fuchsia-200 text-[11px] font-medium text-fuchsia-700">
                          GPT-5.5
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={reviewAndReviseMicrodramaScripts}
                        disabled={
                          Object.keys(generatedChapters).length === 0 ||
                          isEditingChapter ||
                          hasActiveGeneration ||
                          isRewritingChapter
                        }
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                      >
                        <Sparkles className={`w-4 h-4 ${isReviewingScripts ? 'animate-spin' : ''}`} />
                        <span>{isReviewingScripts ? '审读修订中...' : '审读并打磨全剧'}</span>
                      </button>
                    </div>
                  )}

		                <button
		                  onClick={exportChapter}
		                  disabled={!visibleChapterContent || isRewritingChapter}
	                  className="w-full flex items-center justify-center space-x-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded font-medium disabled:cursor-not-allowed"
	                >
	                  <Download className="w-4 h-4" />
	                  <span>导出当前{unitLabel}</span>
	                </button>
	              </div>
	            </div>

          </div>

          {/* 内容展示区域 */}
          <div className="lg:col-span-6">
	            {(visibleChapterContent || generationState.isGenerating) ? (
              <div className="card p-8 bg-white/95 backdrop-blur-sm shadow-xl border-0">
                <div className="mb-6 pb-4 border-b border-secondary-200 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-secondary-900 mb-2">
                      {getUnitRangeDisplay(currentChapter)}
                    </h2>
                    {generationState.isGenerating && (
                      <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                        <span>
                          正在生成{generationState.currentGeneratingChapter ? getUnitRangeDisplay(generationState.currentGeneratingChapter) : '正文'}
                          {autoFollowStreaming && currentChapter === generationState.currentGeneratingChapter ? '，正在跟随最新输出' : '，已暂停自动跟随'}
                        </span>
                        {(!autoFollowStreaming || currentChapter !== generationState.currentGeneratingChapter) && (
                          <button
                            type="button"
                            onClick={followLatestStreamingOutput}
                            className="rounded-md bg-orange-600 px-2 py-1 font-medium text-white hover:bg-orange-700"
                          >
                            跟随最新
                          </button>
                        )}
                      </div>
                    )}
                    {isEditingChapter && chapterDraftTouched && (
                      <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 inline-block px-2 py-1 rounded">
                        未保存的修改
                      </div>
                    )}
                  </div>

	                  <div className="flex items-center gap-2 flex-shrink-0">
	                    {!isEditingChapter ? (
	                      <button
	                        onClick={clearCurrentChapter}
	                        disabled={
	                          generationState.isGenerating ||
	                          isBatchGenerating ||
	                          isFullCycleGenerating ||
                            isSegmentGenerating ||
	                          isRewritingChapter ||
		                          !visibleChapterContent
	                        }
	                        className="inline-flex items-center gap-1 px-3 py-2 bg-red-50 hover:bg-red-100 disabled:bg-gray-100 disabled:text-gray-400 text-red-700 rounded-lg text-sm font-medium disabled:cursor-not-allowed"
	                        title={`清空当前${unitLabel}内容（可重新生成）`}
	                      >
	                        <Trash2 className="w-4 h-4" />
	                        清空
	                      </button>
	                    ) : (
	                      <button
	                        onClick={cancelEditChapter}
	                        className="px-3 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-lg text-sm font-medium"
	                        title="取消编辑（不保存修改）"
	                      >
	                        取消
	                      </button>
	                    )}
	                  </div>
                </div>
                <div className="prose prose-base max-w-none">
                  {!isEditingChapter ? (
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
	                      {visibleChapterContent.split('\n\n').map((paragraph, index) => {
                        // 检查是否是标题行
                        const isTitleLine = paragraph.match(/^第\d+章\s*\[/);
                        const isEpisodeTitleLine = paragraph.match(/^第\d+集\s*\[/);
                        const isEmptyLine = paragraph.trim() === '';

                        if (isEmptyLine) return null;

                        return (
                          <p
                            key={index}
                            className="mb-4"
                            style={{
                              textIndent: isTitleLine || isEpisodeTitleLine ? '0' : '2em',
                              marginBottom: '1.2em',
                              textAlign: 'justify', // 两端对齐
                            }}
                          >
                            {paragraph.trim()}
                          </p>
                        );
                      })}
	                  <div ref={contentEndRef} />
	                </div>
                  ) : (
                    <div className="space-y-4">
                      <textarea
                        value={chapterDraft}
                        onChange={(e) => {
                          setChapterDraft(e.target.value);
                          setChapterDraftTouched(true);
                        }}
                        className="w-full min-h-[520px] p-4 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-secondary-800"
                        style={{
                          lineHeight: '1.8',
                          fontFamily: '"Noto Serif SC", "Source Han Serif SC", "宋体", serif',
                          fontSize: '16px',
                          letterSpacing: '0.3px',
                          whiteSpace: 'pre-wrap',
                        }}
                        placeholder="在这里编辑正文内容，保存后后续生成会引用最新文档。"
                      />
                      <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-lg border border-secondary-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                        <button
                          onClick={cancelEditChapter}
                          className="px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-lg text-sm font-medium"
                          title="取消编辑（不保存修改）"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => {
                            pendingEditScrollYRef.current = window.scrollY;
                            saveChapter();
                          }}
                          disabled={!chapterDraft}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                          title={`保存当前${unitLabel}修改`}
                        >
                          <Save className="w-4 h-4" />
                          保存
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card p-12 text-center">
                <PenTool className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-secondary-900 mb-2">
                  {isMicrodrama ? '准备开始写剧本' : '准备开始写作'}
                </h3>
                <p className="text-secondary-600 mb-6">
                  {isMicrodrama
                    ? '点击生成按钮，AI将基于分集细纲为你创作标准微短剧单集正文'
                    : '点击"生成章节内容"按钮，AI将基于完整的故事架构为你创作精彩的章节内容'}
                </p>
                <div className="text-sm text-secondary-500">
                  💡 AI会自动整合项目大纲、世界观、人设、中故事等所有背景信息
                </div>
              </div>
            )}
          </div>

          {/* 小故事/分集对照面板 */}
          <div className="lg:col-span-3">
            <div className="sticky top-8 space-y-6">
              {/* 当前章节或当前集对应的卡片 */}
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-secondary-900 mb-4 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-primary-600" />
                  {isMicrodrama ? '分集对照' : '章节对照'}
                </h3>

                {(() => {
                  const chapterIndex = currentChapter - 1;
                  const currentMicroStory = isMicrodrama
                    ? microStoriesInOrder?.[chapterIndex]
                    : getMicroStoryForChapter(currentChapter);

                  if (currentMicroStory) {
                    return (
                      <div className="space-y-4">
                        <div className="bg-primary-50 p-3 rounded-lg">
                          <h4 className="font-medium text-primary-900 mb-2">
                            {isMicrodrama ? `第${chapterIndex + 1}集卡` : `第${chapterIndex + 1}个小故事`}
                          </h4>
                          <p className="text-sm text-primary-800 font-medium mb-2">
                            {currentMicroStory.title}
                          </p>
                          <div className="text-xs text-primary-700 bg-white p-3 rounded border-l-2 border-primary-500 max-h-40 overflow-y-auto">
                            {currentMicroStory.content}
                          </div>
                        </div>

                        <div className="text-xs text-secondary-500 space-y-1">
                          <p>• 对应{isMicrodrama ? '分集' : '章节'}：第{currentChapter}{unitLabel}</p>
                          <p>• 中故事：{currentMicroStory.macroStoryTitle}</p>
                          <p>• 顺序：第{currentMicroStory.order + 1}{isMicrodrama ? '集' : '个小故事'}</p>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="text-center py-8 text-secondary-500">
                        <FileText className="w-12 h-12 mx-auto mb-3 text-secondary-300" />
                        <p className="text-sm">未找到对应的{isMicrodrama ? '分集卡' : '小故事'}</p>
                        <p className="text-xs mt-1">
                          请确保已在情节结构细化界面生成并保存{isMicrodrama ? '分集' : '小故事'}
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
                  {isMicrodrama ? (
                    <>
                      <p>• 每集按你设置的目标字数生成，成稿完整但不拖长</p>
                      <p>• {actionFirstScript ? '动作和镜头为主，台词为辅' : '对话与可见动作并重'}，强推进、强情绪、强钩子</p>
                      <p>• 结尾必须切黑场或留致命悬念</p>
                      <p>• 延续上一集的动作与情绪，不要断档</p>
                    </>
                  ) : (
                    <>
                      <p>• 每章以约 {normalizeTargetNovelWords(targetNovelWords)} 字为目标；超过 3000 字会先做小故事边界校验，裁剪后仍超再自动压缩约 30%。</p>
                      <p>• 包含吸引人的章节标题</p>
                      <p>• 融入完整的故事背景</p>
                      <p>• 保持连贯的阅读体验</p>
                    </>
                  )}
                  {previousChapterEnding && (
                    <div>
                      <p className="font-medium text-secondary-900 mt-3 mb-1">衔接参考：</p>
                      <p className="text-xs bg-secondary-50 p-2 rounded">
                        {previousChapterEnding.substring(0, 100)}...
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-5 pt-4 border-t border-secondary-200 flex justify-end gap-2">
                  {!isEditingChapter ? (
                    <button
                      onClick={startEditChapter}
                      disabled={
                        generationState.isGenerating ||
                        isBatchGenerating ||
                        isFullCycleGenerating ||
                        isSegmentGenerating ||
                        isRewritingChapter ||
	                        !visibleChapterContent
                      }
                      className="inline-flex items-center gap-2 px-4 py-2 bg-secondary-900 hover:bg-secondary-800 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                      title={`编辑当前${unitLabel}内容（保存后将作为后续引用的最新正文）`}
                    >
                      <PenTool className="w-4 h-4" />
                      编辑
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={cancelEditChapter}
                        className="px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-lg text-sm font-medium"
                        title="取消编辑（不保存修改）"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => saveChapter()}
                        disabled={!chapterDraft}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                        title={`保存当前${unitLabel}修改`}
                      >
                        <Save className="w-4 h-4" />
                        保存
                      </button>
                    </>
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
                    {isRegenerateMode ? `选择重新生成起始${unitLabel}` : `选择继续生成起始${unitLabel}`}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {isRegenerateMode
                      ? `从选中的${unitLabel}开始重新生成，将覆盖现有内容`
                      : `从选中的${unitLabel}开始生成后续所有未生成的内容`
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
              {microStoriesInOrder && microStoriesInOrder.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="text-sm text-gray-700">
                      共 {microStoriesInOrder.length * unitsPerMicroStory} {unitLabel}，默认从最新内容往前选
                    </div>
                    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
                      <button
                        onClick={() => setChapterListOrder('desc')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          chapterListOrder === 'desc'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        倒序
                      </button>
                      <button
                        onClick={() => setChapterListOrder('asc')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          chapterListOrder === 'asc'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        正序
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(chapterListOrder === 'desc'
                      ? chapterStoryEntries.slice().reverse()
                      : chapterStoryEntries
                    ).map(({ story, chapterNumber, originalIndex }) => {
                      const storyIndex = originalIndex;
                      const chapterStart = chapterNumber;
                      const chapterEnd = chapterNumber;
                      const isGenerated = isMicrodrama
                        ? !!generatedChapters[chapterStart]
                        : !!(generatedChapters[chapterStart] && generatedChapters[chapterEnd]);
                      const isPartiallyGenerated = isMicrodrama
                        ? !!generatedChapters[chapterStart]
                        : !!(generatedChapters[chapterStart] || generatedChapters[chapterEnd]);
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
                                {isMicrodrama ? `第${storyIndex + 1}集` : `第${storyIndex + 1}个小故事`}
                              </h4>
                              <p className="text-sm text-gray-600 mb-2 line-clamp-1">
                                {story.title}
                              </p>
                              <div className="flex items-center space-x-2 text-xs text-gray-500">
                                <span>{isMicrodrama ? `第${chapterStart}集` : `第${chapterStart}～${chapterEnd}章`}</span>
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
                                ? `从第${chapterStart}${unitLabel}重新生成`
                                : `从第${chapterStart}${unitLabel}开始生成`
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
                            已选择：从第{selectedStartChapter}{unitLabel}{isRegenerateMode ? '重新' : ''}开始生成
                          </p>
                          <p className={`text-xs mt-1 ${
                            isRegenerateMode ? 'text-red-700' : 'text-blue-700'
                          }`}>
                            {isRegenerateMode
                              ? `将重新生成从第${selectedStartChapter}${unitLabel}到最后的全部内容（覆盖现有内容）`
                              : `将生成从第${selectedStartChapter}${unitLabel}到最后的全部内容`
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
                  <p>未找到{isMicrodrama ? '分集' : '小故事'}数据</p>
                  <p className="text-sm mt-1">请先在情节结构细化页面生成并保存{isMicrodrama ? '分集' : '小故事'}</p>
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
                              {version.chapterCount}{unitLabel} • {version.totalWords}字
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
