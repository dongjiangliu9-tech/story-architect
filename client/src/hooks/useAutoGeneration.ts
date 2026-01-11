import { useState, useCallback, useRef, useEffect } from 'react';
import { OutlineData } from '../types';
import { blueprintApi } from '../services/api';
import { useWorldSettings } from '../contexts/WorldSettingsContext';

export interface AutoGenerationStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  message?: string;
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
      { id: 'generate-outline', label: '生成情节细纲', status: 'pending' },
      { id: 'save-project', label: '保存项目', status: 'pending' },
      { id: 'micro-stories', label: '细化第一个中故事为小故事', status: 'pending' },
      { id: 'select-stories', label: '自动选择小故事', status: 'pending' },
      { id: 'complete', label: '完成', status: 'pending' }
    ];
    setSteps(initialSteps);
  }, []);

  const formatOutlineData = (outline: OutlineData): string => {
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
  };

  const startAutoGeneration = useCallback(async (
    selectedOutline: OutlineData,
    bookName: string,
    onComplete: (projectId: number, shouldNavigateToStructure?: boolean) => void,
    onError: (error: string) => void
  ) => {
    setIsAutoGenerating(true);
    initializeSteps();

    try {
      // 清理旧缓存
      clearCache(bookName);

      // 1. 导入故事灵感
      updateStep('import-outline', { status: 'running', message: '正在导入选中的故事灵感...' });
      setCurrentStepMessage('正在导入选中的故事灵感...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟导入时间

      updateStep('import-outline', { status: 'completed', message: '故事灵感导入完成' });

      const outlineData = formatOutlineData(selectedOutline);

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
          outline: outlineData
        });
        setCachedData(bookName, 'world-setting', worldResponse.data);
        updateStep('generate-world', { status: 'completed', message: '世界观基础设定生成完成' });
      }

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
          outline: outlineData,
          worldSetting: worldResponse.data
        });
        setCachedData(bookName, 'characters', charactersResponse.data);
        updateStep('generate-characters', { status: 'completed', message: '人物设定生成完成' });
      }

      // 4. 生成情节细纲
      updateStep('generate-outline', { status: 'running', message: '正在生成情节细纲...' });
      setCurrentStepMessage('正在生成情节细纲...');

      let outlineResponse;
      const cachedOutline = getCachedData(bookName, 'detailed-outline');
      if (cachedOutline) {
        outlineResponse = { data: cachedOutline };
        updateStep('generate-outline', { status: 'completed', message: '从缓存加载情节细纲' });
      } else {
        outlineResponse = await blueprintApi.generateDetailedOutline({
          outline: outlineData,
          worldSetting: worldResponse.data,
          characters: charactersResponse.data
        });
        setCachedData(bookName, 'detailed-outline', outlineResponse.data);
        updateStep('generate-outline', { status: 'completed', message: '情节细纲生成完成' });
      }

      // 5. 保存项目
      updateStep('save-project', { status: 'running', message: '正在保存项目...' });
      setCurrentStepMessage('正在保存项目...');

      const newProject = createProject(bookName, selectedOutline, {
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        detailedOutline: outlineResponse.data,
      });

      updateStep('save-project', { status: 'completed', message: '项目保存完成' });

      // 6. 细化第一个中故事为小故事
      updateStep('micro-stories', { status: 'running', message: '正在细化第一个中故事为小故事...' });
      setCurrentStepMessage('正在细化第一个中故事为小故事...');

      // 检查缓存
      let savedMicroStories: any[] = [];
      const cachedMicroStories = getCachedData(bookName, 'micro-stories');
      if (cachedMicroStories) {
        savedMicroStories = cachedMicroStories;
        updateStep('micro-stories', { status: 'completed', message: `从缓存加载 ${savedMicroStories.length} 个小故事` });
      } else {
        // 解析情节细纲，提取中故事
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

        // 只处理第一个中故事
        const macroStory = macroStories[0];
        if (!macroStory || !macroStory.content) {
          console.error('第一个中故事内容为空');
          updateStep('micro-stories', { status: 'error', message: '第一个中故事内容为空' });
          throw new Error('第一个中故事内容为空');
        }

        setCurrentStepMessage(`正在细化第一个中故事：${macroStory.title}...`);
        console.log(`正在处理第一个中故事: ${macroStory.title}`);
        console.log(`中故事内容长度: ${macroStory.content.length}`);

        try {
          const microResponse = await blueprintApi.generateMicroStories({
            macroStory: macroStory.content,
            storyIndex: "一" // 第一个中故事
          });

          console.log(`第一个中故事API响应长度:`, microResponse.data?.length || 0);

          // 解析生成的微故事
          const microStories = parseMicroStories(microResponse.data, 0, macroStory.title, macroStory.content);
          console.log(`第一个中故事解析出 ${microStories.length} 个小故事`);

          if (microStories.length === 0) {
            console.error('未能从第一个中故事解析出任何小故事');
            updateStep('micro-stories', { status: 'error', message: '未能解析出小故事，请检查AI生成格式' });
            throw new Error('未能从第一个中故事解析出任何小故事');
          }

          savedMicroStories = microStories;

          updateStep('micro-stories', {
            progress: 100,
            message: `已完成第一个中故事细化，共生成 ${savedMicroStories.length} 个小故事`
          });

        } catch (error) {
          console.error(`生成第一个中故事的小故事失败:`, error);
          updateStep('micro-stories', { status: 'error', message: `生成失败: ${error instanceof Error ? error.message : '未知错误'}` });
          throw error;
        }

        console.log(`第一个中故事细化完成，共生成 ${savedMicroStories.length} 个小故事`);

        // 缓存小故事
        setCachedData(bookName, 'micro-stories', savedMicroStories);

        updateStep('micro-stories', { status: 'completed', message: `第一个中故事细化完成，共生成 ${savedMicroStories.length} 个小故事` });
      }

        // 保存小故事到项目 - 同时更新savedMicroStories和microStoryOutlines
        // 生成microStoryOutlines格式，与手动生成时保持一致
        const outlineContent = savedMicroStories.map((story, index) => {
          return `【小故事${index + 1}】${story.title}\n\n${story.content}`;
        }).join('\n\n---\n\n');

        const microStoryOutlines: {[key: string]: string} = {
          'story_0': outlineContent
        };

        if (isMountedRef.current) {
          updateProject(newProject.id, {
            savedMicroStories: savedMicroStories,
            microStoryOutlines: microStoryOutlines
          });

          console.log('项目更新完成，保存的小故事数据:', {
            savedMicroStoriesCount: savedMicroStories.length,
            microStoryOutlinesKeys: Object.keys(microStoryOutlines),
            firstOutlineLength: microStoryOutlines['story_0']?.length || 0
          });
        }

      // 7. 自动选择前4个小故事用于章节生成
      updateStep('select-stories', { status: 'running', message: '正在自动选择小故事用于章节生成...' });
      setCurrentStepMessage('正在自动选择小故事用于章节生成...');

      // 自动选择前4个小故事（跳过用户手动选择的过程）
      const selectedStories = savedMicroStories.slice(0, 4); // 取前4个小故事

      // 更新项目，标记已选择的小故事
      if (isMountedRef.current) {
        updateProject(newProject.id, {
          selectedMicroStories: selectedStories, // 添加已选择的小故事字段
          autoSelectedStories: true // 标记为自动选择
        });
      }

      console.log(`自动选择了 ${selectedStories.length} 个小故事用于章节生成:`, selectedStories.map(s => s.title));

      await new Promise(resolve => setTimeout(resolve, 1000)); // 短暂准备时间

      updateStep('select-stories', { status: 'completed', message: `已自动选择 ${selectedStories.length} 个小故事用于章节生成` });

      // 8. 完成 - 跳转到正文写作界面并自动开始生成
      updateStep('complete', { status: 'completed', message: '一键自动生成完成！正在跳转到正文写作工作室...' });
      setCurrentStepMessage('一键自动生成完成！正在跳转到正文写作工作室...');

      // 短暂延迟后跳转到正文写作界面，确保数据已经保存
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('准备跳转到正文写作界面，项目ID:', newProject.id);
      onComplete(newProject.id, false); // 第二个参数为false，表示跳转到writer界面

    } catch (error) {
      console.error('自动生成失败:', error);
      const errorStep = steps.find(step => step.status === 'running');
      if (errorStep) {
        updateStep(errorStep.id, {
          status: 'error',
          message: error instanceof Error ? error.message : '生成失败'
        });
      }
      onError(error instanceof Error ? error.message : '自动生成失败');
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

  for (const line of lines) {
    // 匹配中故事标题 - 支持多种格式
    const titleMatch = line.match(/(?:【中故事([一二三四五六七八九十\d]+)】|\[中故事([一二三四五六七八九十\d]+)\]|中故事([一二三四五六七八九十\d]+)[:：]|(\d+)\.\s*([^【\[]+)|([一二三四五六七八九十\d]+)[\.\s]+([^【\[]+))/);

    if (titleMatch) {
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
function parseMicroStories(content: string, macroIndex: number, macroTitle: string, macroContent: string): any[] {
  const microStories: any[] = [];
  const lines = content.split('\n');

  let currentMicro: {title: string, content: string[]} | null = null;
  let microStoryIndex = 0;

  for (const line of lines) {
    // 匹配小故事标题 - 支持多种格式
    const titleMatch = line.match(/(?:【小故事([一二三四五六七八九十\d]+)】|小故事([一二三四五六七八九十\d]+)[:：])(.+)/);
    if (titleMatch) {
      if (currentMicro) {
        microStories.push({
          id: `micro_${macroIndex}_${microStoryIndex}`,
          title: currentMicro.title,
          content: currentMicro.content.join('\n').trim(),
          macroStoryId: `macro_${macroIndex}`,
          macroStoryTitle: macroTitle,
          macroStoryContent: macroContent,
          order: microStoryIndex,
          createdAt: new Date().toISOString()
        });
        microStoryIndex++;
      }
      const title = titleMatch[3]?.trim() || titleMatch[2]?.trim() || line.replace(/【?小故事[一二三四五六七八九十\d]+】?[:：]?/, '').trim();
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
      id: `micro_${macroIndex}_${microStoryIndex}`,
      title: currentMicro.title,
      content: currentMicro.content.join('\n').trim(),
      macroStoryId: `macro_${macroIndex}`,
      macroStoryTitle: macroTitle,
      macroStoryContent: macroContent,
      order: microStoryIndex,
      createdAt: new Date().toISOString()
    });
  }

  console.log(`解析出 ${microStories.length} 个小故事，符合SavedMicroStory格式`);
  return microStories;
}