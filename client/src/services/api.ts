import axios from 'axios';
import { GenerateOutlineDto, GenerateOutlineResponse } from '../types';

const api = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || '/api',
  timeout: 600000, // 10分钟超时，给官方 Gemini 高负载重试留出时间
  headers: {
    'Content-Type': 'application/json',
  },
});

const ACTIVATION_CODE_STORAGE_KEY = 'story-architect-activation-code';
const AI_ENDPOINTS = new Set([
  '/blueprint/generate',
  '/blueprint/generate-world-setting',
  '/blueprint/generate-characters',
  '/blueprint/generate-detailed-outline',
  '/blueprint/generate-micro-stories',
  '/blueprint/generate-micro-story-variants',
  '/blueprint/generate-chapter',
  '/blueprint/prepare-stream',
]);

function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase();
}

function isAiEndpoint(url?: string): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return AI_ENDPOINTS.has(path);
}

function shouldBypassActivationPrompt(): boolean {
  if (typeof window === 'undefined') return true;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function readStoredActivationCode(): string {
  if (typeof window === 'undefined') return '';
  return normalizeActivationCode(window.localStorage.getItem(ACTIVATION_CODE_STORAGE_KEY) || '');
}

function storeActivationCode(code: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVATION_CODE_STORAGE_KEY, normalizeActivationCode(code));
}

function clearActivationCode() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
}

function requestActivationCode(message = '请输入激活码后再调用AI功能：'): string {
  if (typeof window === 'undefined') {
    throw new Error('需要激活码才能调用AI功能');
  }

  const code = window.prompt(message, readStoredActivationCode());
  const normalizedCode = normalizeActivationCode(code || '');
  if (!normalizedCode) {
    throw new Error('需要激活码才能调用AI功能');
  }

  storeActivationCode(normalizedCode);
  return normalizedCode;
}

function attachActivationCode(config: any, code: string) {
  config.headers = config.headers || {};
  config.headers['X-Activation-Code'] = code;
}

api.interceptors.request.use((config) => {
  if (!isAiEndpoint(config.url)) {
    return config;
  }

  const storedCode = readStoredActivationCode();
  if (storedCode) {
    attachActivationCode(config, storedCode);
    return config;
  }

  if (!shouldBypassActivationPrompt()) {
    attachActivationCode(config, requestActivationCode());
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as any;
    const message = error?.response?.data?.message || '';

    if (
      config &&
      !config.__activationRetried &&
      isAiEndpoint(config.url) &&
      error?.response?.status === 401 &&
      String(message).includes('激活码')
    ) {
      config.__activationRetried = true;
      clearActivationCode();
      attachActivationCode(config, requestActivationCode('激活码无效，请重新输入：'));
      return api(config);
    }

    return Promise.reject(error);
  }
);

export interface GenerateWorldSettingDto {
  outline: string;
  needsUpgradeSystem?: boolean;
  existingWorldSetting?: string;
  note?: string;
}

export interface GenerateCharactersDto {
  outline: string;
  worldSetting: string;
  existingCharacters?: string;
  note?: string;
}

export interface GenerateDetailedOutlineDto {
  outline: string;
  worldSetting: string;
  characters: string;
  mode?: 'novel' | 'microdrama';
  outlineBatchIndex?: number;
  existingDetailedOutline?: string;
  isFinalBatch?: boolean;
}

export interface GenerateMicroStoriesDto {
  macroStory: string;
  storyIndex: string;
  chapterRange?: string;
  mode?: 'novel' | 'microdrama';
}

export interface GenerateMicroStoryVariantsDto {
  macroStory: string;
  currentTitle: string;
  currentContent: string;
  previousContent?: string;
  nextContent?: string;
  selectedVariantTitle?: string;
  selectedVariantContent?: string;
  targetStories?: Array<{ index: number; title: string; content: string }>;
  selectedVariantStories?: Array<{ index: number; title: string; content: string }>;
  targetType?: 'micro' | 'macro';
  worldSetting?: string;
  characters?: string;
  note?: string;
  storyIndex?: string;
  microIndex?: string;
  mode?: 'novel' | 'microdrama';
}

export interface GenerateChapterDto {
  context: string;
  chapterNumber: number;
  unitCount?: number;
  previousEnding?: string;
  savedMicroStories?: any[];
  generatedChapters?: { [key: number]: string };
  mode?: 'novel' | 'microdrama';
}

export const blueprintApi = {
  generateOutline: async (data: GenerateOutlineDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate', data);
    return response.data;
  },

  generateWorldSetting: async (data: GenerateWorldSettingDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-world-setting', data);
    return response.data;
  },

  generateCharacters: async (data: GenerateCharactersDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-characters', data);
    return response.data;
  },

  generateDetailedOutline: async (data: GenerateDetailedOutlineDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-detailed-outline', data);
    return response.data;
  },

  generateMicroStories: async (data: GenerateMicroStoriesDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-micro-stories', data);
    return response.data;
  },

  generateMicroStoryVariants: async (data: GenerateMicroStoryVariantsDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-micro-story-variants', data);
    return response.data;
  },

  generateChapter: async (data: GenerateChapterDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-chapter', data);
    return response.data;
  },

  prepareChapterStream: async (data: GenerateChapterDto): Promise<{requestId: string}> => {
    const response = await api.post('/blueprint/prepare-stream', data);
    return response.data;
  },

  generateChapterStream: (requestId: string): EventSource => {
    const eventSource = new EventSource(`${(import.meta as any).env.VITE_API_BASE_URL || '/api'}/blueprint/generate-chapter-stream?requestId=${requestId}`);
    return eventSource;
  },

  cancelGeneration: async (requestId: string): Promise<void> => {
    await api.post('/blueprint/cancel-generation', { requestId });
  },

  exportAsDocx: async (data: { chapters: { [key: number]: string }, bookName: string }): Promise<{ success: boolean, data: string, filename: string }> => {
    const response = await api.post('/blueprint/export-docx', data);
    return response.data;
  },
};

export default api;
