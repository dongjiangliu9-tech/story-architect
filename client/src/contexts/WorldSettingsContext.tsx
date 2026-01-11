import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { OutlineData } from '../types';

const WORLD_SETTINGS_KEY = 'story-architect-world-settings';

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

interface WorldSettingsContextType {
  projects: WorldSettingsProject[];
  currentProject: WorldSettingsProject | null;
  createProject: (bookName: string, outline: OutlineData, additionalData?: Partial<WorldSettingsProject>) => WorldSettingsProject;
  updateProject: (projectId: number, updates: Partial<WorldSettingsProject>) => void;
  deleteProject: (projectId: number) => void;
  loadProject: (project: WorldSettingsProject) => void;
  exportProject: (project: WorldSettingsProject) => void;
  exportAllProjects: () => void;
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

  // 加载项目
  const loadProject = (project: WorldSettingsProject) => {
    setCurrentProject(project);
    console.log('加载项目:', project.bookName);
  };

  // 导出单个项目
  const exportProject = (project: WorldSettingsProject) => {
    const dataStr = JSON.stringify(project, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = `${project.bookName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_world_settings.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    console.log('导出项目:', project.bookName);
  };

  // 导出所有项目
  const exportAllProjects = () => {
    const dataStr = JSON.stringify(projects, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = `story_architect_world_settings_${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    console.log('导出所有项目:', projects.length, '个');
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