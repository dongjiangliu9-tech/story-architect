import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { OutlineData } from '../types';

const SAVED_OUTLINES_KEY = 'story-architect-saved-outlines';

interface SavedOutlinesContextType {
  savedOutlines: OutlineData[];
  saveOutline: (outline: OutlineData) => void;
  removeSavedOutline: (id: number) => void;
  isOutlineSaved: (outline: OutlineData) => boolean;
  exportOutline: (outline: OutlineData) => void;
  exportAllSaved: () => void;
}

const SavedOutlinesContext = createContext<SavedOutlinesContextType | undefined>(undefined);

export function SavedOutlinesProvider({ children }: { children: ReactNode }) {
  const [savedOutlines, setSavedOutlines] = useState<OutlineData[]>([]);

  // 从localStorage加载保存的数据
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_OUTLINES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('从localStorage加载了', parsed.length, '个保存的大纲');
        setSavedOutlines(parsed);
      } else {
        console.log('localStorage中没有保存的数据');
      }
    } catch (error) {
      console.error('Failed to load saved outlines:', error);
    }
  }, []);

  // 保存到localStorage
  const saveToStorage = (outlines: OutlineData[]) => {
    try {
      localStorage.setItem(SAVED_OUTLINES_KEY, JSON.stringify(outlines));
      console.log('成功保存到localStorage:', outlines.length, '个大纲');
    } catch (error) {
      console.error('Failed to save outlines:', error);
    }
  };

  // 保存大纲
  const saveOutline = (outline: OutlineData) => {
    const newOutline = {
      ...outline,
      savedAt: new Date().toISOString(),
      id: Date.now(), // 重新生成ID避免冲突
    };

    const updatedOutlines = [...savedOutlines, newOutline];
    console.log('准备保存大纲:', newOutline.title);
    console.log('当前保存数量:', savedOutlines.length);
    console.log('保存后数量:', updatedOutlines.length);

    // 先存储到localStorage
    saveToStorage(updatedOutlines);

    // 再更新状态
    setSavedOutlines(updatedOutlines);

    // 验证存储是否成功
    setTimeout(() => {
      const stored = localStorage.getItem(SAVED_OUTLINES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('验证存储成功，存储了', parsed.length, '个大纲');
      } else {
        console.error('存储验证失败，localStorage中没有数据');
      }
    }, 100);
  };

  // 删除保存的大纲
  const removeSavedOutline = (id: number) => {
    const updatedOutlines = savedOutlines.filter(outline => outline.id !== id);
    setSavedOutlines(updatedOutlines);
    saveToStorage(updatedOutlines);
  };

  // 检查大纲是否已保存
  const isOutlineSaved = (outline: OutlineData) => {
    const result = savedOutlines.some(saved =>
      saved.title === outline.title &&
      saved.logline === outline.logline &&
      saved.characters === outline.characters
    );
    console.log('检查大纲是否已保存:', outline.title, '结果:', result, '总保存数量:', savedOutlines.length);
    return result;
  };

  // 导出为JSON文件
  const exportOutline = (outline: OutlineData) => {
    const dataStr = JSON.stringify(outline, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = `${outline.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_outline.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // 导出所有保存的大纲
  const exportAllSaved = () => {
    const dataStr = JSON.stringify(savedOutlines, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = `story_architect_saved_outlines_${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  return (
    <SavedOutlinesContext.Provider value={{
      savedOutlines,
      saveOutline,
      removeSavedOutline,
      isOutlineSaved,
      exportOutline,
      exportAllSaved,
    }}>
      {children}
    </SavedOutlinesContext.Provider>
  );
}

export function useSavedOutlines() {
  const context = useContext(SavedOutlinesContext);
  if (context === undefined) {
    throw new Error('useSavedOutlines must be used within a SavedOutlinesProvider');
  }
  return context;
}