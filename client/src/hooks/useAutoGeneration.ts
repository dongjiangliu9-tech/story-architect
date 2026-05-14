import { useState, useCallback, useRef, useEffect } from 'react';
import { OutlineData } from '../types';
import { blueprintApi } from '../services/api';
import { useWorldSettings } from '../contexts/WorldSettingsContext';
import {
  getLogicModelRequestFromSources,
  toPreferredLogicModelFields,
} from '../utils/llmModelSelection';
import {
  buildDensityTuningSuggestion,
  DENSITY_TUNING_KEYS,
  emptyDensityLevels,
} from '../utils/densityTuning';

export interface AutoGenerationStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  message?: string;
}

export type AutoGenerationTarget = 'microdrama-15' | 'microdrama-30' | 'novel-75';
export type AutoGenerationPauseMode = 'none' | 'density' | 'first-micro-story';
export type AutoGenerationDestination = 'world-setting' | 'story-structure' | 'writer';

export interface AutoGenerationOptions {
  target: AutoGenerationTarget;
  pauseAfter?: AutoGenerationPauseMode;
  clearExisting?: boolean;
}

export function useAutoGeneration() {
  const { createProject, updateProject } = useWorldSettings();
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [steps, setSteps] = useState<AutoGenerationStep[]>([]);
  const [currentStepMessage, setCurrentStepMessage] = useState<string>('');

  // 用于跟踪组件是否仍然mounted，防止在组件卸载后执行异步操作
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 缓存键生成函数
  const getCacheKey = (bookName: string, step: string) => `auto_gen_${bookName}_${step}`;

  // 从缓存获取数据
  const getCachedData = (bookName: string, step: string) => {
    try {
      const cacheKey = getCacheKey(bookName, step);
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // 检查缓存是否过期（24小时）
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          return parsed.data;
        } else {
          // 清理过期缓存
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (error) {
      console.error('读取缓存失败:', error);
    }
    return null;
  };

  // 缓存数据
  const setCachedData = (bookName: string, step: string, data: any) => {
    try {
      const cacheKey = getCacheKey(bookName, step);
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (error) {
      console.error('写入缓存失败:', error);
    }
  };

  // 清理缓存
  const clearCache = (bookName: string) => {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(`auto_gen_${bookName}_`));
      keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.error('清理缓存失败:', error);
    }
  };

  const mergeExpansionPack = (baseContent: string, title: string, expansionPack: string) => {
    const base = String(baseContent || '').trim();
    const expansion = String(expansionPack || '').trim();
    if (!expansion) return base;
    if (!base) return `${title}\n${expansion}`;
    return `${base}\n\n${title}\n${expansion}`;
  };

  const updateStep = useCallback((stepId: string, updates: Partial<AutoGenerationStep>) => {
    setSteps(prev => prev.map(step =>
      step.id === stepId ? { ...step, ...updates } : step
    ));
  }, []);

  const initializeSteps = useCallback(() => {
    const initialSteps: AutoGenerationStep[] = [
      { id: 'import-outline', label: '导入故事灵感', status: 'pending' },
      { id: 'generate-world', label: '生成世界观基础设定', status: 'pending' },
      { id: 'generate-characters', label: '生成人物设定', status: 'pending' },
      { id: 'generate-outline', label: '生成目标作品情节细纲', status: 'pending' },
      { id: 'density-iterate', label: '单轮滑块密度迭代', status: 'pending' },
      { id: 'save-project', label: '保存项目', status: 'pending' },
      { id: 'micro-stories', label: '细化全部中故事为正文细纲', status: 'pending' },
      { id: 'complete', label: '完成', status: 'pending' }
    ];
    setSteps(initialSteps);
  }, []);

  const sortGeneratedMicroStories = (stories: any[]) => [...stories].sort((a, b) => {
    const ma = Number(String(a.macroStoryId).replace('story_', ''));
    const mb = Number(String(b.macroStoryId).replace('story_', ''));
    if (ma !== mb) return ma - mb;
    return Number(a.order || 0) - Number(b.order || 0);
  });

  const formatOutlineData = (outline: OutlineData): string => {
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
  };

  const startAutoGeneration = useCallback(async (
    selectedOutline: OutlineData,
    bookName: string,
    onComplete: (projectId: number, destination?: AutoGenerationDestination) => void,
    onError: (error: string) => void,
    options: AutoGenerationOptions = { target: 'microdrama-15' }
  ) => {
    setIsAutoGenerating(true);
    initializeSteps();
    let lastSafeDestination: AutoGenerationDestination = 'world-setting';
    let autoProject: ReturnType<typeof createProject> | null = null;

    try {
      const targetMode = options.target === 'novel-75' ? 'novel' : 'microdrama';
      const isMicrodrama = targetMode === 'microdrama';
      const microdramaEpisodeCount = options.target === 'microdrama-30' ? 30 : 15;
      const targetUnitCount = isMicrodrama ? microdramaEpisodeCount : 75;
      const targetLabel = isMicrodrama ? `${microdramaEpisodeCount}集微短剧` : '75章网文';
      const targetCachePrefix = isMicrodrama ? `microdrama-${microdramaEpisodeCount}` : 'novel-75';
      const outlineCacheKey = `${targetCachePrefix}-detailed-outline`;
      const preIteratedOutlineCacheKey = `${targetCachePrefix}-detailed-outline-pre-v1`;
      const finalOutlineCacheKey = `${targetCachePrefix}-detailed-outline-density-v3`;
      const microStoriesCacheKey = `${targetCachePrefix}-all-micro-stories`;
      const expandedWorldCacheKey = `${targetCachePrefix}-world-expanded-forces-v2`;
      const expandedCharactersCacheKey = `${targetCachePrefix}-characters-expanded-v1`;

      // 清理旧缓存
      if (options.clearExisting !== false) {
        clearCache(bookName);
      }

      // 1. 导入故事灵感
      updateStep('import-outline', { status: 'running', message: '正在导入选中的故事灵感...' });
      setCurrentStepMessage('正在导入选中的故事灵感...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟导入时间

      updateStep('import-outline', { status: 'completed', message: '故事灵感导入完成' });

      const outlineData = formatOutlineData(selectedOutline);
      const logicModelRequest = getLogicModelRequestFromSources(selectedOutline);
      const preferredLogicModelFields = toPreferredLogicModelFields(logicModelRequest.llmModel);
      autoProject = createProject(bookName, selectedOutline, {
        detailedOutlineMode: targetMode,
        microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent: true,
        autoGenerationMode: true,
        autoGenerationStarted: false,
        ...preferredLogicModelFields,
      });
      const persistAutoProject = (updates: Parameters<typeof updateProject>[1]) => {
        if (!isMountedRef.current || !autoProject) return;
        updateProject(autoProject.id, updates);
      };

      // 2. 生成世界观基础设定
      updateStep('generate-world', { status: 'running', message: '正在生成世界观基础设定...' });
      setCurrentStepMessage('正在生成世界观基础设定...');

      let worldResponse;
      const cachedWorld = getCachedData(bookName, 'world-setting');
      if (cachedWorld) {
        worldResponse = { data: cachedWorld };
        updateStep('generate-world', { status: 'completed', message: '从缓存加载世界观基础设定' });
      } else {
        worldResponse = await blueprintApi.generateWorldSetting({
          ...logicModelRequest,
          outline: outlineData
        });
        setCachedData(bookName, 'world-setting', worldResponse.data);
        updateStep('generate-world', { status: 'completed', message: '世界观基础设定生成完成' });
      }
      persistAutoProject({
        worldSetting: worldResponse.data,
        detailedOutlineMode: targetMode,
        microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent: true,
      });

      const cachedExpandedWorld = getCachedData(bookName, expandedWorldCacheKey);
      if (isMicrodrama) {
        updateStep('generate-world', { status: 'completed', message: '微短剧自动化跳过世界观扩展包，采用基础世界观' });
      } else if (cachedExpandedWorld) {
        worldResponse = { data: cachedExpandedWorld };
        updateStep('generate-world', { status: 'completed', message: '从缓存加载扩充后的世界观基础设定' });
      } else {
        updateStep('generate-world', { status: 'running', message: '正在自动补充世界观：增加势力与副本...' });
        setCurrentStepMessage('正在自动补充世界观：增加势力与副本...');
        const baseWorldSetting = worldResponse.data;
        const expandedWorldResponse = await blueprintApi.generateWorldSetting({
          ...logicModelRequest,
          outline: outlineData,
          existingWorldSetting: baseWorldSetting,
          note: '[AUTO_EXPANSION_PACK_ONLY]\n请只生成新增世界观扩展包：新增20个可直接用于正文展开的具体势力，新增20个副本/试炼/任务/危机事件场景。具体势力必须写清名称、类型、领袖或核心人物、资源/能力、地盘或活动范围、公开目标、隐藏目的、与主角和其他势力的关系、可制造的冲突、可服务的章节阶段。副本/试炼/任务/危机事件必须写清触发条件、参与势力、主要冲突、可获得资源或代价、可服务的章节阶段，以及能牵引主角成长或人物关系变化的钩子。不要输出完整更新版，不要复写原有世界观。',
        });
        worldResponse = {
          data: mergeExpansionPack(baseWorldSetting, '【世界观扩展包】', expandedWorldResponse.data),
        };
        setCachedData(bookName, expandedWorldCacheKey, worldResponse.data);
        updateStep('generate-world', { status: 'completed', message: '世界观扩充完成：已补充势力与副本' });
      }
      persistAutoProject({
        worldSetting: worldResponse.data,
      });

      // 3. 生成人物设定
      updateStep('generate-characters', { status: 'running', message: '正在生成人物设定...' });
      setCurrentStepMessage('正在生成人物设定...');

      let charactersResponse;
      const cachedCharacters = getCachedData(bookName, 'characters');
      if (cachedCharacters) {
        charactersResponse = { data: cachedCharacters };
        updateStep('generate-characters', { status: 'completed', message: '从缓存加载人物设定' });
      } else {
        charactersResponse = await blueprintApi.generateCharacters({
          ...logicModelRequest,
          outline: outlineData,
          worldSetting: worldResponse.data,
          mode: targetMode,
          microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        });
        setCachedData(bookName, 'characters', charactersResponse.data);
        updateStep('generate-characters', { status: 'completed', message: '人物设定生成完成' });
      }
      persistAutoProject({
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
      });

      const cachedExpandedCharacters = getCachedData(bookName, expandedCharactersCacheKey);
      if (isMicrodrama) {
        updateStep('generate-characters', { status: 'completed', message: '微短剧自动化跳过人物扩展包，采用基础人物设定' });
      } else if (cachedExpandedCharacters) {
        charactersResponse = { data: cachedExpandedCharacters };
        updateStep('generate-characters', { status: 'completed', message: '从缓存加载扩充后的人物设定' });
      } else {
        updateStep('generate-characters', { status: 'running', message: '正在自动补充人物设定：增加阶段出场角色...' });
        setCurrentStepMessage('正在自动补充人物设定：增加阶段出场角色...');
        const baseCharacters = charactersResponse.data;
        const expandedCharactersResponse = await blueprintApi.generateCharacters({
          ...logicModelRequest,
          outline: outlineData,
          worldSetting: worldResponse.data,
          mode: targetMode,
          microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
          existingCharacters: baseCharacters,
          note: '[AUTO_EXPANSION_PACK_ONLY]\n请只生成新增人物扩展包：新增30个会在不同阶段出场的角色。每个角色必须写清出场阶段、身份阵营、欲望目标、能力/资源、与主角或核心人物的关系、首次登场场景、能制造的冲突、后续可回收的伏笔或反转。角色要覆盖前期压迫、中期副本/任务、后期势力博弈等不同阶段。不要输出完整更新版，不要复写原有人物设定。',
        });
        charactersResponse = {
          data: mergeExpansionPack(baseCharacters, '【人物扩展包】', expandedCharactersResponse.data),
        };
        setCachedData(bookName, expandedCharactersCacheKey, charactersResponse.data);
        updateStep('generate-characters', { status: 'completed', message: '人物设定扩充完成：已补充阶段出场角色' });
      }
      persistAutoProject({
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
      });

      // 4. 生成情节细纲
      updateStep('generate-outline', { status: 'running', message: '正在生成情节细纲...' });
      setCurrentStepMessage('正在生成情节细纲...');

      let outlineResponse;
      const cachedOutline = getCachedData(bookName, outlineCacheKey);
      if (cachedOutline) {
        outlineResponse = { data: cachedOutline };
        updateStep('generate-outline', { status: 'completed', message: `从缓存加载${targetLabel}情节细纲` });
      } else {
        outlineResponse = await blueprintApi.generateDetailedOutline({
          ...logicModelRequest,
          outline: outlineData,
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          mode: targetMode,
          microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent: true,
          outlineBatchIndex: 1,
          existingDetailedOutline: ''
        });
        setCachedData(bookName, outlineCacheKey, outlineResponse.data);
        updateStep('generate-outline', { status: 'completed', message: `${targetLabel}情节细纲生成完成` });
      }
      persistAutoProject({
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        detailedOutline: outlineResponse.data,
        detailedOutlineMode: targetMode,
        microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent: true,
      });

      updateStep('density-iterate', { status: 'running', message: '正在进行单轮三密度滑块迭代...' });
      setCurrentStepMessage('正在进行单轮三密度滑块迭代...');

      let detailedOutline = outlineResponse.data;
      const cachedPreIteratedOutline = getCachedData(bookName, preIteratedOutlineCacheKey);
      if (!isMicrodrama) {
        if (cachedPreIteratedOutline) {
          detailedOutline = cachedPreIteratedOutline;
          updateStep('density-iterate', { status: 'running', message: '从缓存加载预迭代后的中故事细纲...' });
        } else {
          updateStep('density-iterate', { status: 'running', message: '正在进行中故事预迭代：扩充剧情承载力...' });
          setCurrentStepMessage('正在进行中故事预迭代：扩充剧情承载力...');
          const preIteratedOutlineResponse = await blueprintApi.generateDetailedOutline({
            ...logicModelRequest,
            outline: outlineData,
            worldSetting: worldResponse.data,
            characters: charactersResponse.data,
            mode: targetMode,
            reduceSensitiveContent: true,
            outlineBatchIndex: 1,
            existingDetailedOutline: detailedOutline,
            outlineRevisionSuggestion: '现有的中故事内容需要能支撑15章的连续剧情，需要AI进行自动化的融合更多实力与未出场的角色，设计更复杂的桥段，重新设计每个中故事。必须保留原有主线方向，但显著增加每个中故事内部的事件层级、角色参与度、副本/任务/危机结构、阶段目标、反转点、伏笔回收和章节承载力。每个中故事要足够拆成15个单章小故事，每个小故事对应一章，避免两三章就写完。请输出完整新版情节细纲，不要输出说明或差异对比。',
          });
          detailedOutline = preIteratedOutlineResponse.data;
          setCachedData(bookName, preIteratedOutlineCacheKey, detailedOutline);
        }
      }
      let currentDensityLevels = emptyDensityLevels();
      const enabledDensity = Object.fromEntries(DENSITY_TUNING_KEYS.map(key => [key, true])) as Record<typeof DENSITY_TUNING_KEYS[number], boolean>;

      const densityIterationCount = 1;
      const targetDensityLevel = 3;

      for (let iteration = 1; iteration <= densityIterationCount; iteration++) {
        const nextDensityLevels = {
          emotion: targetDensityLevel,
          plot: targetDensityLevel,
          element: targetDensityLevel,
        };
        const suggestion = buildDensityTuningSuggestion(currentDensityLevels, nextDensityLevels, enabledDensity, targetMode);

        updateStep('density-iterate', {
          status: 'running',
          progress: Math.round(((iteration - 1) / densityIterationCount) * 100),
          message: `正在进行第${iteration}/${densityIterationCount}轮密度迭代...`
        });
        setCurrentStepMessage(`正在进行第${iteration}/${densityIterationCount}轮密度迭代...`);

        const densityResponse = await blueprintApi.generateDetailedOutline({
          ...logicModelRequest,
          outline: outlineData,
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          mode: targetMode,
          microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent: true,
          outlineBatchIndex: 1,
          existingDetailedOutline: detailedOutline,
          outlineRevisionSuggestion: suggestion,
        });

        detailedOutline = densityResponse.data;
        currentDensityLevels = nextDensityLevels;
      }

      outlineResponse = { data: detailedOutline };
      setCachedData(bookName, finalOutlineCacheKey, detailedOutline);
      updateStep('density-iterate', { status: 'completed', progress: 100, message: '单轮密度迭代完成，采用高强度结果' });
      persistAutoProject({
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        detailedOutline: outlineResponse.data,
        detailedOutlineMode: targetMode,
        microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        densityTuningLevels: currentDensityLevels,
        reduceSensitiveContent: true,
      });

      // 5. 保存项目
      updateStep('save-project', { status: 'running', message: '正在保存项目...' });
      setCurrentStepMessage('正在保存项目...');

      persistAutoProject({
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        detailedOutline: outlineResponse.data,
        detailedOutlineMode: targetMode,
        microdramaEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
        densityTuningLevels: currentDensityLevels,
        reduceSensitiveContent: true,
        ...preferredLogicModelFields,
      });
      const newProject = autoProject;
      if (!newProject) throw new Error('自动项目初始化失败');
      lastSafeDestination = 'world-setting';

      updateStep('save-project', { status: 'completed', message: '项目保存完成' });

      if (options.pauseAfter === 'density') {
        updateStep('complete', {
          status: 'completed',
          message: '已暂停在中故事细纲检查点，可在人设与世界观页查看、修改或清空后重新生成。'
        });
        setCurrentStepMessage('已暂停在中故事细纲检查点，可先查看三滑块迭代结果。');
        await new Promise(resolve => setTimeout(resolve, 800));
        onComplete(newProject.id, 'world-setting');
        return;
      }

      // 6. 细化全部中故事为小故事/分集细纲
      lastSafeDestination = 'story-structure';
      updateStep('micro-stories', { status: 'running', message: `正在细化全部中故事为${isMicrodrama ? '分集' : '小故事'}细纲...` });
      setCurrentStepMessage(`正在细化全部中故事为${isMicrodrama ? '分集' : '小故事'}细纲...`);

      let savedMicroStories: any[] = [];
      const microStoryOutlines: {[key: string]: string} = {};
      const cachedMicroStories = getCachedData(bookName, microStoriesCacheKey);
      if (cachedMicroStories) {
        savedMicroStories = cachedMicroStories;
        updateStep('micro-stories', { status: 'completed', message: `从缓存加载 ${savedMicroStories.length} 个${isMicrodrama ? '分集' : '小故事'}细纲` });
      } else {
        const macroStories = parseMacroStories(outlineResponse.data);
        console.log(`解析到 ${macroStories.length} 个中故事：`, macroStories.map(s => s.title));

        if (macroStories.length === 0) {
          console.error('未能解析到任何中故事，请检查情节细纲格式');
          console.error('情节细纲内容长度:', outlineResponse.data.length);
          console.error('情节细纲内容预览 (前1000字符):', outlineResponse.data.substring(0, 1000));

          // 查找可能的标题格式
          const lines = outlineResponse.data.split('\n');
          const possibleTitles = lines.filter((line: string) =>
            line.includes('中故事') ||
            line.includes('【') ||
            line.match(/^\d+[\.\s]/) ||
            line.match(/^[一二三四五六七八九十]+[\.\s]/) ||
            line.match(/故事[一二三四五六七八九十\d]+/)
          );
          console.error('找到的可能标题行:', possibleTitles.slice(0, 10));

          updateStep('micro-stories', {
            status: 'error',
            message: '未能解析到中故事，请查看控制台日志了解详细格式'
          });
          throw new Error('未能解析到中故事，请检查AI生成的情节细纲格式。查看浏览器控制台获取详细调试信息。');
        }

        for (let macroIndex = 0; macroIndex < macroStories.length; macroIndex++) {
          const macroStory = macroStories[macroIndex];
          if (!macroStory?.content) continue;

          const chapterRange = isMicrodrama
            ? (parseChapterRangeFromMacroStory(macroStory.content, '集') || getMicrodramaChapterRange(macroIndex, macroStories.length, targetUnitCount))
            : getNovelChapterRange(macroIndex);
          updateStep('micro-stories', {
            status: 'running',
            progress: Math.round((macroIndex / macroStories.length) * 100),
            message: `正在细化中故事 ${macroIndex + 1}/${macroStories.length}（第${chapterRange.start}-${chapterRange.end}${isMicrodrama ? '集' : '章'}）...`
          });
          setCurrentStepMessage(`正在细化中故事 ${macroIndex + 1}/${macroStories.length}（第${chapterRange.start}-${chapterRange.end}${isMicrodrama ? '集' : '章'}）...`);

          const microResponse = await blueprintApi.generateMicroStories({
            ...logicModelRequest,
            macroStory: macroStory.content,
            storyIndex: getChineseNumber(macroIndex + 1),
            chapterRange: `${chapterRange.start}-${chapterRange.end}`,
            mode: targetMode,
          });

          microStoryOutlines[`story_${macroIndex}`] = microResponse.data;
          const microStories = parseMicroStories(microResponse.data, macroIndex, macroStory.title, macroStory.content, chapterRange.start, isMicrodrama ? '集' : '章');
          savedMicroStories = [...savedMicroStories, ...microStories];
          if (isMountedRef.current) {
            const sortedPartial = sortGeneratedMicroStories(savedMicroStories);
            updateProject(newProject.id, {
              microStoryOutlines,
              savedMicroStories: sortedPartial,
              selectedMicroStories: sortedPartial,
              microStoryEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
              autoSelectedStories: true,
              autoGenerationMode: true,
              autoGenerationStarted: false,
            });
          }

          if (options.pauseAfter === 'first-micro-story' && savedMicroStories.length > 0) {
            savedMicroStories.sort((a, b) => {
              const ma = Number(String(a.macroStoryId).replace('story_', ''));
              const mb = Number(String(b.macroStoryId).replace('story_', ''));
              if (ma !== mb) return ma - mb;
              return a.order - b.order;
            });

            if (isMountedRef.current) {
              updateProject(newProject.id, {
                savedMicroStories,
                selectedMicroStories: savedMicroStories,
                microStoryOutlines,
                microStoryEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
                autoSelectedStories: true,
                autoGenerationMode: true,
                autoGenerationStarted: false,
              });
            }

            updateStep('micro-stories', {
              status: 'completed',
              progress: Math.round(((macroIndex + 1) / macroStories.length) * 100),
              message: `已生成第一批${isMicrodrama ? '分集' : '章节'}细纲，共 ${savedMicroStories.length} 个，等待确认查看`
            });
            updateStep('complete', {
              status: 'completed',
              message: '已暂停在第一批小故事细化检查点，可在情节结构页查看、修改或清空后重新生成。'
            });
            setCurrentStepMessage('已暂停在第一批小故事细化检查点，可先确认细化方向。');
            await new Promise(resolve => setTimeout(resolve, 800));
            onComplete(newProject.id, 'story-structure');
            return;
          }

          if (!isMicrodrama && savedMicroStories.length >= targetUnitCount) {
            break;
          }
          if (isMicrodrama && savedMicroStories.length >= targetUnitCount) {
            break;
          }
        }

        savedMicroStories.sort((a, b) => {
          const ma = Number(String(a.macroStoryId).replace('story_', ''));
          const mb = Number(String(b.macroStoryId).replace('story_', ''));
          if (ma !== mb) return ma - mb;
          return a.order - b.order;
        });

        const limitedStories = isMicrodrama
          ? savedMicroStories.slice(0, targetUnitCount)
          : savedMicroStories.slice(0, targetUnitCount);
        savedMicroStories = limitedStories;

        setCachedData(bookName, microStoriesCacheKey, savedMicroStories);
        updateStep('micro-stories', {
          status: 'completed',
          progress: 100,
          message: isMicrodrama
            ? `全部分集细纲完成，共 ${savedMicroStories.length} 集`
            : `全部小故事细纲完成，共 ${savedMicroStories.length} 个，可生成 ${savedMicroStories.length} 章`
        });
      }

        if (isMountedRef.current) {
          updateProject(newProject.id, {
            savedMicroStories,
            selectedMicroStories: savedMicroStories,
            microStoryOutlines,
            microStoryEpisodeCount: isMicrodrama ? microdramaEpisodeCount : undefined,
            autoSelectedStories: true,
            autoGenerationMode: true,
            autoGenerationStarted: true,
          });

          console.log('项目更新完成，保存的小故事数据:', {
            savedMicroStoriesCount: savedMicroStories.length,
            microStoryOutlinesKeys: Object.keys(microStoryOutlines),
            firstOutlineLength: microStoryOutlines['story_0']?.length || 0
          });
        }

      updateStep('complete', {
        status: 'completed',
        message: `前置自动化完成，正在进入正文写作并自动生成${isMicrodrama ? '剧本' : '小说正文'}...`
      });
      setCurrentStepMessage(`前置自动化完成，正在进入正文写作并自动生成${isMicrodrama ? '剧本' : '小说正文'}...`);

      // 短暂延迟后跳转到正文写作界面，确保数据已经保存
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('准备跳转到正文写作界面，项目ID:', newProject.id);
      localStorage.setItem('story-architect-auto-flow', 'writer');
      localStorage.setItem('story-architect-auto-flow-project-id', String(newProject.id));
      localStorage.setItem('story-architect-auto-flow-source', 'full-auto');
      localStorage.setItem('story-architect-auto-flow-created-at', String(Date.now()));
      localStorage.setItem('story-architect-auto-export-json', 'true');
      onComplete(newProject.id, 'writer');

    } catch (error) {
      console.error('自动生成失败:', error);
      const errorStep = steps.find(step => step.status === 'running');
      const message = error instanceof Error ? error.message : '自动生成失败';
      if (errorStep) {
        updateStep(errorStep.id, {
          status: 'error',
          message
        });
      }
      if (autoProject) {
        updateProject(autoProject.id, {
          autoGenerationMode: false,
          autoGenerationStarted: false,
        });
        onError(`${message}\n\n已保存本次自动生成中已经完成的内容，可从当前项目继续手动生成或重试。`);
        onComplete(autoProject.id, lastSafeDestination);
      } else {
        onError(message);
      }
    } finally {
      setIsAutoGenerating(false);
    }
  }, [createProject, updateProject, updateStep, initializeSteps, steps]);

  const cancelAutoGeneration = useCallback(() => {
    if (!isMountedRef.current) return;

    setIsAutoGenerating(false);
    setSteps([]);
    setCurrentStepMessage('');
  }, []);

  return {
    isAutoGenerating,
    steps,
    currentStepMessage,
    startAutoGeneration,
    cancelAutoGeneration
  };
}

// 解析情节细纲中的中故事
function parseMacroStories(outlineContent: string): Array<{title: string, content: string}> {
  const stories: Array<{title: string, content: string}> = [];
  const lines = outlineContent.split('\n');

  let currentStory: {title: string, content: string[]} | null = null;
  let lastStoryNumber = 0;

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

  for (const line of lines) {
    // 匹配中故事标题 - 支持多种格式
    const titleMatch = line.match(/(?:【中故事([一二三四五六七八九十\d]+)】|\[中故事([一二三四五六七八九十\d]+)\]|中故事([一二三四五六七八九十\d]+)[:：]|(\d+)\.\s*([^【\[]+)|([一二三四五六七八九十\d]+)[\.\s]+([^【\[]+))/);

    if (titleMatch) {
      const matchedNumberText = titleMatch[1] || titleMatch[2] || titleMatch[3] || titleMatch[4] || titleMatch[6] || '';
      const matchedNumber = chineseNumberToInt(matchedNumberText);
      const shouldStartNewStory = matchedNumber > lastStoryNumber;

      if (!shouldStartNewStory) {
        if (currentStory && line.trim()) {
          currentStory.content.push(line);
        }
        continue;
      }

      if (currentStory) {
        stories.push({
          title: currentStory.title,
          content: currentStory.content.join('\n')
        });
      }

      // 提取标题内容，支持多种格式
      let title = '';

      if (titleMatch[1] || titleMatch[2] || titleMatch[3]) {
        // 【中故事一】格式
        const matchedNumber = titleMatch[1] || titleMatch[2] || titleMatch[3];
        if (line.includes('【中故事')) {
          title = line.replace(/【中故事[一二三四五六七八九十\d]+】/, '').trim();
        } else if (line.includes('[中故事')) {
          title = line.replace(/\[中故事[一二三四五六七八九十\d]+\]/, '').trim();
        } else if (line.includes('中故事')) {
          title = line.replace(/中故事[一二三四五六七八九十\d]+[:：]/, '').trim();
        }
        if (!title.trim()) {
          title = `中故事${matchedNumber}`;
        }
      } else if (titleMatch[4] && titleMatch[5]) {
        // 1. 标题格式
        title = titleMatch[5].trim();
      } else if (titleMatch[6] && titleMatch[7]) {
        // 一. 标题格式
        title = titleMatch[7].trim();
      } else {
        // 其他格式，直接使用整行作为标题
        title = line.replace(/【?\[?中故事[一二三四五六七八九十\d]*】?\]?\s*[:：]?\s*/, '').trim();
      }

      currentStory = {
        title: title,
        content: []
      };
      lastStoryNumber = matchedNumber;

      console.log(`找到中故事标题: ${title} (原始行: ${line.trim()})`);
    } else if (currentStory && line.trim() &&
               !line.match(/^===/) && !line.match(/^---/) &&
               !line.match(/^[\*\-\s]*$/) &&
               !line.match(/^\d+\.$/) &&
               !line.match(/^[一二三四五六七八九十]+\.$/)) {
      // 过滤掉分隔线、空行和可能的标题格式
      currentStory.content.push(line);
    }
  }

  // 添加最后一个中故事
  if (currentStory) {
    stories.push({
      title: currentStory.title,
      content: currentStory.content.join('\n')
    });
  }

  console.log(`解析完成，共找到 ${stories.length} 个中故事:`);
  stories.forEach((story, index) => {
    console.log(`${index + 1}. ${story.title} (${story.content.length} 字符)`);
  });

  // 如果没有找到中故事，输出调试信息
  if (stories.length === 0) {
    console.error('未能解析到任何中故事，输出内容预览:');
    console.error(outlineContent.substring(0, 1000));

    // 尝试查找可能的标题格式
    const possibleTitles = lines.filter(line =>
      line.includes('中故事') ||
      line.includes('【') ||
      line.match(/^\d+[\.\s]/) ||
      line.match(/^[一二三四五六七八九十]+[\.\s]/)
    );
    console.error('可能的标题行:', possibleTitles.slice(0, 10));
  }

  return stories;
}

// 解析微故事内容，返回符合SavedMicroStory接口的格式
function getChineseNumber(num: number): string {
  const numbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return numbers[num - 1] || num.toString();
}

function getMicrodramaChapterRange(macroIndex: number, macroCount: number, episodeCount = 30) {
  if (macroCount <= 1) {
    return { start: 1, end: episodeCount };
  }

  const base = Math.floor(episodeCount / macroCount);
  const remainder = episodeCount % macroCount;
  let start = 1;
  for (let i = 0; i < macroIndex; i++) {
    start += base + (i < remainder ? 1 : 0);
  }
  const count = base + (macroIndex < remainder ? 1 : 0);
  return { start, end: start + Math.max(1, count) - 1 };
}

function getNovelChapterRange(macroIndex: number) {
  const start = macroIndex * 15 + 1;
  return { start, end: start + 14 };
}

function parseChapterRangeFromMacroStory(content: string, unitLabel: '集' | '章') {
  const unitPattern = unitLabel === '集' ? '集' : '章';
  const match = content.match(new RegExp(`(?:对应(?:集数|章节|范围)|第)?\\s*(\\d+)\\s*[-~—至到]\\s*(\\d+)\\s*${unitPattern}`))
    || content.match(new RegExp(`第\\s*(\\d+)\\s*${unitPattern}\\s*[-~—至到]\\s*第?\\s*(\\d+)\\s*${unitPattern}`));

  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

function parseMicroStories(content: string, macroIndex: number, macroTitle: string, macroContent: string, startEpisode = 1, unitLabel: '集' | '章' = '集'): any[] {
  const microStories: any[] = [];
  const lines = content.split('\n');

  let currentMicro: {title: string, content: string[]} | null = null;
  let microStoryIndex = 0;

  for (const line of lines) {
    // 匹配小故事标题 - 支持多种格式
    const titleMatch = line.match(/(?:【(?:小故事|分集|单集)([一二三四五六七八九十\d]+)】|(?:小故事|分集|单集)([一二三四五六七八九十\d]+)[:：]|【第\s*([一二三四五六七八九十\d]+)\s*[章节集]】|第\s*([一二三四五六七八九十\d]+)\s*[章节集]\s*[:：、-]?\s*)(.*)/);
    if (titleMatch) {
      if (currentMicro) {
        microStories.push({
          id: `story_${macroIndex}_micro_${microStoryIndex}_${Date.now()}_${Math.random()}`,
          title: currentMicro.title,
          content: currentMicro.content.join('\n').trim(),
          macroStoryId: `story_${macroIndex}`,
          macroStoryTitle: macroTitle,
          macroStoryContent: macroContent,
          order: microStoryIndex,
          createdAt: new Date().toISOString()
        });
        microStoryIndex++;
      }
      const absoluteEpisode = startEpisode + microStoryIndex;
      const titleText = titleMatch[5]?.trim() || '';
      const title = titleText || `第${absoluteEpisode}${unitLabel}`;
      currentMicro = {
        title: title,
        content: []
      };
    } else if (currentMicro && line.trim()) {
      currentMicro.content.push(line);
    }
  }

  // 添加最后一个小故事
  if (currentMicro) {
    microStories.push({
      id: `story_${macroIndex}_micro_${microStoryIndex}_${Date.now()}_${Math.random()}`,
      title: currentMicro.title,
      content: currentMicro.content.join('\n').trim(),
      macroStoryId: `story_${macroIndex}`,
      macroStoryTitle: macroTitle,
      macroStoryContent: macroContent,
      order: microStoryIndex,
      createdAt: new Date().toISOString()
    });
  }

  console.log(`解析出 ${microStories.length} 个小故事，符合SavedMicroStory格式`);
  return microStories;
}
