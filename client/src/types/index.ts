// API 相关类型
export interface GenerateOutlineDto {
  channel: string;
  style: string;
  theme: string;
  requiresSpecialPower?: boolean;
  llmModelProvider?: LlmModelProvider;
  llmModel?: string;
}

export interface GenerateOutlineResponse {
  success: boolean;
  data: string;
}

// UI 相关类型
export interface OutlineData {
  id: number;
  title: string;
  aliasTitle?: string;
  aliasSynopsis?: string;
  aliasTags?: string[];
  logline: string;
  hook: string;
  characters: string;
  world: string;
  themes: string;
  rawContent: string;
  requiresSpecialPower?: boolean;
  savedAt?: string; // 保存时间戳（可选）
  preferredLlmModelProvider?: LlmModelProvider;
  preferredLlmModel?: string;
}

export type LlmModelProvider = 'default' | 'gateway';
export type WriterModelProvider = 'deepseek' | 'gemini' | 'gateway';

export interface TitleVariant {
  title: string;
  synopsis: string;
  tags: string[];
}

export interface LlmModelSelection {
  llmModelProvider?: LlmModelProvider;
  llmModel?: string;
}

export type DensityTuningKey = 'emotion' | 'plot' | 'element';

export type DensityTuningLevels = Record<DensityTuningKey, number>;

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
