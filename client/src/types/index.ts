// API 相关类型
export interface GenerateOutlineDto {
  channel: string;
  style: string;
  theme: string;
}

export interface GenerateOutlineResponse {
  success: boolean;
  data: string;
}

// UI 相关类型
export interface OutlineData {
  id: number;
  title: string;
  logline: string;
  hook: string;
  characters: string;
  world: string;
  themes: string;
  rawContent: string;
  savedAt?: string; // 保存时间戳（可选）
}

// 网文分类类型
export interface NovelCategory {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

export interface NovelStyle {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

// 应用状态类型
export interface AppState {
  selectedCategory: NovelCategory | null;
  selectedStyles: NovelStyle[];
  theme: string;
  isGenerating: boolean;
  outlines: OutlineData[];
  currentOutlineIndex: number;
  error: string | null;
}