import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { OutlineData } from '../types';

const WORLD_SETTINGS_KEY = 'story-architect-world-settings';
const EXPORT_SCHEMA_VERSION = 1;

export interface SavedMicroStory {
  id: string;
  title: string;
  content: string;
  macroStoryId: string; // 所属的中故事ID
  macroStoryTitle: string; // 中故事标题
  macroStoryContent: string; // 中故事内容
  order: number; // 在中故事中的顺序
  createdAt: string;
}

/**
 * 将 SavedMicroStory 排序为“章节自然顺序”：
 * - 先按 macroStoryId（story_0, story_1...）的数字顺序
 * - 再按 order（该中故事内的小故事顺序）
 *
 * WriterPage 里会用数组索引去做“章节 ↔ 小故事”的映射，因此必须保持稳定顺序，
 * 否则在“更新/覆盖某个中故事的小故事”后会出现章节对照错位（例如第1章变成第21章的小故事）。
 */
export function getMacroStoryIndexFromId(macroStoryId: string): number {
  const m = macroStoryId.match(/story_(\d+)/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function sortSavedMicroStoriesForChapters(stories: SavedMicroStory[]): SavedMicroStory[] {
  return [...stories].sort((a, b) => {
    const ma = getMacroStoryIndexFromId(a.macroStoryId);
    const mb = getMacroStoryIndexFromId(b.macroStoryId);
    if (ma !== mb) return ma - mb;
    if (a.order !== b.order) return a.order - b.order;
    // 最后用 createdAt 稳定排序（避免同 macro/order 时顺序飘）
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

export interface SavedVersion {
  id: string;
  timestamp: string;
  chapterCount: number;
  totalWords: number;
  chapters: { [key: number]: string };
  preview: string;
}

export interface WorldSettingsProject {
  id: number;
  bookName: string;
  outline: OutlineData;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  microStories?: {[key: string]: string[]}; // 中故事ID -> 微故事ID数组
  microStoryOutlines?: {[key: string]: string}; // 中故事ID -> 小故事细纲内容
  savedMicroStories?: SavedMicroStory[]; // 保存的小故事列表
  selectedMicroStories?: SavedMicroStory[]; // 已选择用于生成的小故事
  generatedChapters?: {[key: number]: string}; // 生成的章节内容
  savedVersions?: SavedVersion[]; // 保存的版本历史
  autoGenerationMode?: boolean; // 是否为自动生成模式
  autoGenerationStarted?: boolean; // 是否已启动自动生成
  autoSelectedStories?: boolean; // 是否自动选择了小故事
  createdAt: string;
  updatedAt: string;
}

export interface WriterStateSnapshot {
  generatedContent?: string;
  currentChapter?: number;
  previousChapterEnding?: string;
  generatedChapters?: {[key: number]: string};
  generationState?: {
    isGenerating: boolean;
    currentGeneratingChapter: number | null;
    totalChapters: number;
    completedChapters: number[];
  };
  timestamp?: number;
}

export interface ProjectExportBundleV1 {
  schemaVersion: number;
  exportedAt: string;
  app: 'story-architect';
  type: 'project';
  project: WorldSettingsProject;
  localState?: {
    writerState?: WriterStateSnapshot | null;
  };
}

export interface ProjectsExportBundleV1 {
  schemaVersion: number;
  exportedAt: string;
  app: 'story-architect';
  type: 'projects';
  projects: WorldSettingsProject[];
  localState?: {
    writerStateByProjectId?: Record<string, WriterStateSnapshot | null>;
  };
}

interface WorldSettingsContextType {
  projects: WorldSettingsProject[];
  currentProject: WorldSettingsProject | null;
  createProject: (bookName: string, outline: OutlineData, additionalData?: Partial<WorldSettingsProject>) => WorldSettingsProject;
  updateProject: (projectId: number, updates: Partial<WorldSettingsProject>) => void;
  deleteProject: (projectId: number) => void;
  loadProject: (project: WorldSettingsProject) => void;
  exportProject: (project: WorldSettingsProject) => void;
  exportAllProjects: () => void;
  importFromJsonText: (jsonText: string) => { imported: number; skipped: number; currentProjectId?: number };
  // 清理“已生成小说正文”相关缓存（保留世界观/人物/大纲/小故事等设定）
  clearNovelCacheForProject: (projectId: number) => void;
  clearNovelCacheForAllProjects: () => void;
}

const WorldSettingsContext = createContext<WorldSettingsContextType | undefined>(undefined);

export function WorldSettingsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<WorldSettingsProject[]>([]);
  const [currentProject, setCurrentProject] = useState<WorldSettingsProject | null>(null);

  // 从localStorage加载保存的项目
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WORLD_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('从localStorage加载了', parsed.length, '个世界设定项目');
        console.log('项目详情:', parsed.map((p: WorldSettingsProject) => ({
          id: p.id,
          name: p.bookName,
          hasWorld: !!p.worldSetting,
          hasChar: !!p.characters,
          hasOutline: !!p.detailedOutline
        })));
        setProjects(parsed);
      }
    } catch (error) {
      console.error('Failed to load world settings:', error);
    }
  }, []);

  // 保存到localStorage
  const saveToStorage = (projectsToSave: WorldSettingsProject[]) => {
    try {
      localStorage.setItem(WORLD_SETTINGS_KEY, JSON.stringify(projectsToSave));
      console.log('成功保存到localStorage:', projectsToSave.length, '个项目');
    } catch (error) {
      console.error('Failed to save projects:', error);
    }
  };

  const downloadJson = (data: unknown, filename: string) => {
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', filename);
    linkElement.click();
  };

  const safeParseJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

  const normalizeProject = (raw: unknown): WorldSettingsProject | null => {
    if (!isObject(raw)) return null;
    const outline = raw.outline as OutlineData | undefined;
    if (!outline || typeof outline !== 'object') return null;

    const id = typeof raw.id === 'number' ? raw.id : Date.now();
    const bookName = typeof raw.bookName === 'string' ? raw.bookName : '';
    if (!bookName.trim()) return null;

    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();

    const base = raw as unknown as Partial<WorldSettingsProject>;
    return {
      ...base,
      id,
      bookName: bookName.trim(),
      outline,
      createdAt,
      updatedAt,
    };
  };

  const assignNonCollidingId = (incoming: WorldSettingsProject, existingIds: Set<number>): WorldSettingsProject => {
    if (!existingIds.has(incoming.id)) return incoming;
    // 使用时间戳+随机数，避免与现有ID碰撞
    const newId = Date.now() + Math.floor(Math.random() * 100000);
    return {
      ...incoming,
      id: newId,
      bookName: `${incoming.bookName}（导入）`,
      updatedAt: new Date().toISOString(),
    };
  };

  const restoreLocalStateForProject = (projectId: number, writerState?: WriterStateSnapshot | null) => {
    if (!writerState) return;
    try {
      const key = `writer-state-${projectId}`;
      localStorage.setItem(key, JSON.stringify(writerState));
      // 同时写一份默认key，提升“刷新也能找回”的成功率
      localStorage.setItem('writer-state-default', JSON.stringify(writerState));
    } catch (error) {
      console.error('恢复Writer进度到localStorage失败:', error);
    }
  };

  // 创建新项目
  const createProject = (bookName: string, outline: OutlineData, additionalData?: Partial<WorldSettingsProject>): WorldSettingsProject => {
    const newProject: WorldSettingsProject = {
      id: Date.now(),
      bookName,
      outline,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...additionalData,
    };

    const updatedProjects = [...projects, newProject];
    setProjects(updatedProjects);
    saveToStorage(updatedProjects);
    setCurrentProject(newProject);

    console.log('创建新项目:', newProject.bookName);
    return newProject;
  };

  // 更新项目
  const updateProject = (projectId: number, updates: Partial<WorldSettingsProject>) => {
    const updatedProjects = projects.map(project =>
      project.id === projectId
        ? { ...project, ...updates, updatedAt: new Date().toISOString() }
        : project
    );

    setProjects(updatedProjects);
    saveToStorage(updatedProjects);

    // 如果更新的是当前项目，也更新currentProject
    if (currentProject?.id === projectId) {
      const updatedCurrent = updatedProjects.find(p => p.id === projectId);
      if (updatedCurrent) {
        setCurrentProject(updatedCurrent);
      }
    }

    console.log('更新项目:', projectId, updates);
  };

  // 删除项目
  const deleteProject = (projectId: number) => {
    const updatedProjects = projects.filter(project => project.id !== projectId);
    setProjects(updatedProjects);
    saveToStorage(updatedProjects);

    // 如果删除的是当前项目，清空currentProject
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
    }

    console.log('删除项目:', projectId);
  };

  const clearNovelCacheForProject = (projectId: number) => {
    try {
      // 1) 清理项目内的正文与版本历史（这两者体积最大）
      const updatedProjects = projects.map(project =>
        project.id === projectId
          ? { ...project, generatedChapters: undefined, savedVersions: [] as SavedVersion[], updatedAt: new Date().toISOString() }
          : project
      );
      setProjects(updatedProjects);
      saveToStorage(updatedProjects);

      // 同步更新当前项目引用
      if (currentProject?.id === projectId) {
        const updatedCurrent = updatedProjects.find(p => p.id === projectId) || null;
        setCurrentProject(updatedCurrent);
      }

      // 2) 清理 Writer 临时状态（每个项目一个 key + 默认兜底 key）
      localStorage.removeItem(`writer-state-${projectId}`);
      localStorage.removeItem('writer-state-default');

      // 3) 清理 auto_gen_* 缓存（24h 过期，但这里直接释放空间）
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('auto_gen_')) localStorage.removeItem(key);
      }

      console.log('已清理项目正文缓存:', projectId);
    } catch (error) {
      console.error('清理项目正文缓存失败:', error);
    }
  };

  const clearNovelCacheForAllProjects = () => {
    try {
      // 1) 清理所有项目的正文与版本历史
      const updatedProjects = projects.map(project => ({
        ...project,
        generatedChapters: undefined,
        savedVersions: [] as SavedVersion[],
        updatedAt: new Date().toISOString(),
      }));
      setProjects(updatedProjects);
      saveToStorage(updatedProjects);

      // 同步更新当前项目引用
      if (currentProject) {
        const updatedCurrent = updatedProjects.find(p => p.id === currentProject.id) || null;
        setCurrentProject(updatedCurrent);
      }

      // 2) 清理所有 writer-state-* / 默认 key
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('writer-state-')) localStorage.removeItem(key);
      }
      localStorage.removeItem('writer-state-default');

      // 3) 清理 auto_gen_* 缓存
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('auto_gen_')) localStorage.removeItem(key);
      }

      console.log('已清理全部项目正文缓存');
    } catch (error) {
      console.error('清理全部项目正文缓存失败:', error);
    }
  };

  // 加载项目
  const loadProject = (project: WorldSettingsProject) => {
    setCurrentProject(project);
    console.log('加载项目:', project.bookName);
  };

  // 导出单个项目
  const exportProject = (project: WorldSettingsProject) => {
    const writerStateRaw = localStorage.getItem(`writer-state-${project.id}`);
    const writerState = writerStateRaw ? (safeParseJson(writerStateRaw) as WriterStateSnapshot) : null;

    const bundle: ProjectExportBundleV1 = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'story-architect',
      type: 'project',
      project,
      localState: {
        writerState,
      },
    };

    const exportFileDefaultName = `${project.bookName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_story_architect_project.json`;
    downloadJson(bundle, exportFileDefaultName);

    console.log('导出项目:', project.bookName);
  };

  // 导出所有项目
  const exportAllProjects = () => {
    const writerStateByProjectId: Record<string, WriterStateSnapshot | null> = {};
    for (const p of projects) {
      const raw = localStorage.getItem(`writer-state-${p.id}`);
      writerStateByProjectId[String(p.id)] = raw ? (safeParseJson(raw) as WriterStateSnapshot) : null;
    }

    const bundle: ProjectsExportBundleV1 = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'story-architect',
      type: 'projects',
      projects,
      localState: {
        writerStateByProjectId,
      },
    };

    const exportFileDefaultName = `story_architect_projects_${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(bundle, exportFileDefaultName);

    console.log('导出所有项目:', projects.length, '个');
  };

  const importFromJsonText = (jsonText: string) => {
    const parsed = safeParseJson(jsonText);
    if (!parsed) {
      return { imported: 0, skipped: 0 };
    }

    let incomingProjects: WorldSettingsProject[] = [];
    let writerStateByOldId: Record<string, WriterStateSnapshot | null> = {};

    // 兼容旧格式：直接导出单个project
    if (isObject(parsed) && (parsed as any).bookName && (parsed as any).outline && !(parsed as any).type) {
      const p = normalizeProject(parsed);
      if (p) incomingProjects = [p];
    }

    // 新格式：ProjectExportBundleV1
    if (incomingProjects.length === 0 && isObject(parsed) && (parsed as any).type === 'project' && (parsed as any).project) {
      const p = normalizeProject((parsed as any).project);
      if (p) incomingProjects = [p];
      const ws = (parsed as any).localState?.writerState ?? null;
      if (p) writerStateByOldId[String(p.id)] = ws as WriterStateSnapshot | null;
    }

    // 兼容旧格式：直接导出projects数组
    if (incomingProjects.length === 0 && Array.isArray(parsed)) {
      incomingProjects = parsed.map(normalizeProject).filter((p): p is WorldSettingsProject => !!p);
    }

    // 新格式：ProjectsExportBundleV1
    if (incomingProjects.length === 0 && isObject(parsed) && (parsed as any).type === 'projects' && Array.isArray((parsed as any).projects)) {
      incomingProjects = (parsed as any).projects.map(normalizeProject).filter((p: WorldSettingsProject | null): p is WorldSettingsProject => !!p);
      const wsMap = (parsed as any).localState?.writerStateByProjectId;
      if (wsMap && typeof wsMap === 'object') {
        writerStateByOldId = wsMap as Record<string, WriterStateSnapshot | null>;
      }
    }

    if (incomingProjects.length === 0) {
      return { imported: 0, skipped: 0 };
    }

    const existingIds = new Set(projects.map(p => p.id));
    const importedProjects: WorldSettingsProject[] = [];
    let skipped = 0;

    for (const rawProject of incomingProjects) {
      const normalized = normalizeProject(rawProject);
      if (!normalized) {
        skipped += 1;
        continue;
      }

      const withNewId = assignNonCollidingId(normalized, existingIds);
      existingIds.add(withNewId.id);
      importedProjects.push(withNewId);

      // 恢复Writer进度（如有）
      const ws = writerStateByOldId[String(normalized.id)] ?? null;
      restoreLocalStateForProject(withNewId.id, ws);
    }

    const updatedProjects = [...projects, ...importedProjects];
    setProjects(updatedProjects);
    saveToStorage(updatedProjects);

    // 默认加载最新导入的第一个项目，方便用户立刻看到恢复结果
    const first = importedProjects[0];
    if (first) {
      setCurrentProject(first);
      return { imported: importedProjects.length, skipped, currentProjectId: first.id };
    }

    return { imported: importedProjects.length, skipped };
  };

  return (
    <WorldSettingsContext.Provider value={{
      projects,
      currentProject,
      createProject,
      updateProject,
      deleteProject,
      loadProject,
      exportProject,
      exportAllProjects,
      importFromJsonText,
      clearNovelCacheForProject,
      clearNovelCacheForAllProjects,
    }}>
      {children}
    </WorldSettingsContext.Provider>
  );
}

export function useWorldSettings() {
  const context = useContext(WorldSettingsContext);
  if (context === undefined) {
    throw new Error('useWorldSettings must be used within a WorldSettingsProvider');
  }
  return context;
}