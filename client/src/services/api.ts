import axios from 'axios';
import { GenerateOutlineDto, GenerateOutlineResponse } from '../types';

const api = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || 'https://novelbot.zeabur.app/api',
  timeout: 200000, // 200秒超时，给AI生成足够时间
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false, // 禁用credentials，避免CORS复杂性
});

export interface GenerateWorldSettingDto {
  outline: string;
}

export interface GenerateCharactersDto {
  outline: string;
  worldSetting: string;
}

export interface GenerateDetailedOutlineDto {
  outline: string;
  worldSetting: string;
  characters: string;
}

export interface GenerateMicroStoriesDto {
  macroStory: string;
  storyIndex: string;
  chapterRange?: string;
}

export interface GenerateChapterDto {
  context: string;
  chapterNumber: number;
  previousEnding?: string;
  savedMicroStories?: any[];
  generatedChapters?: { [key: number]: string };
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

  generateChapter: async (data: GenerateChapterDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate-chapter', data);
    return response.data;
  },

  prepareChapterStream: async (data: GenerateChapterDto): Promise<{requestId: string}> => {
    const response = await api.post('/blueprint/prepare-stream', data);
    return response.data;
  },

  generateChapterStream: (requestId: string): EventSource => {
    const baseUrl = (import.meta as any).env.VITE_API_BASE_URL || 'https://novelbot.zeabur.app/api';
    const eventSource = new EventSource(`${baseUrl}/blueprint/generate-chapter-stream?requestId=${requestId}`);
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