import axios from 'axios';
import { GenerateOutlineDto, GenerateOutlineResponse } from '../types';

const api = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || '/api',
  timeout: 600000, // 10分钟超时，给官方 Gemini 高负载重试留出时间
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface GenerateWorldSettingDto {
  outline: string;
  needsUpgradeSystem?: boolean;
}

export interface GenerateCharactersDto {
  outline: string;
  worldSetting: string;
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
