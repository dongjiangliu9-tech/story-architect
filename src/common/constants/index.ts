// 存放故事蓝图系统的静态数据（如大故事类型、中故事列表）

// AI模型配置常量
export const AI_MODELS = {
  // 默认逻辑模型 (Gemini 3 Pro via Yinli)
  DEFAULT_MODEL: 'gemini-3-pro-preview',
  // 写作模型 (DeepSeek，后续界面五使用)
  WRITER_MODEL: 'deepseek-chat',
} as const;

// 故事类型配置
export const STORY_TYPES = {
  // 大故事类型
  FANTASY: 'fantasy',
  SCI_FI: 'sci-fi',
  ROMANCE: 'romance',
  MYSTERY: 'mystery',
  // TODO: 添加更多故事类型
} as const;

export const STORY_GENRES = [
  // TODO: 添加故事类型列表
] as const;

// API配置常量
export const API_CONFIG = {
  DEFAULT_BASE_URL: 'https://yinli.one/v1',
  DEFAULT_PORT: 3000,
} as const;