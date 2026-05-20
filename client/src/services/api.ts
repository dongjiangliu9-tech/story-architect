import axios from 'axios';
import { GenerateOutlineDto, GenerateOutlineResponse, LlmModelSelection, TitleVariant, WriterModelProvider } from '../types';

const api = axios.create({
  baseURL: (import.meta as any).env.VITE_API_BASE_URL || '/api',
  timeout: 600000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const ACTIVATION_CODE_STORAGE_KEY = 'story-architect-activation-code';
const ACTIVATION_BADGE_ID = 'story-architect-activation-quota';
const AI_ENDPOINTS = new Set([
  '/blueprint/generate',
  '/blueprint/generate-title-variants',
  '/blueprint/generate-world-setting',
  '/blueprint/generate-characters',
  '/blueprint/generate-detailed-outline',
  '/blueprint/generate-micro-stories',
  '/blueprint/generate-micro-story-variants',
  '/blueprint/generate-chapter',
  '/blueprint/rewrite-chapter',
  '/blueprint/review-microdrama-scripts',
  '/blueprint/generate-character-prompts',
  '/blueprint/revise-character-prompt',
  '/blueprint/generate-supplemental-asset-prompt',
  '/blueprint/generate-seedance-prompts',
  '/blueprint/export-microdrama-markdown',
  '/blueprint/prepare-stream',
]);

interface ActivationStatusResponse {
  enabled: boolean;
  code: string;
  gemini: { used: number; limit: number; remaining: number };
  deepseek: { used: number; limit: number; remaining: number };
  disabled: boolean;
}

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
  window.dispatchEvent(new CustomEvent('story-architect-activation-updated'));
}

function clearActivationCode() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
}

function removeActivationBadge() {
  if (typeof document === 'undefined') return;
  document.getElementById(ACTIVATION_BADGE_ID)?.remove();
}

function maskActivationCode(code: string): string {
  const normalized = normalizeActivationCode(code);
  if (!normalized) return '未输入';
  if (normalized.length <= 6) return normalized;
  return `${normalized.slice(0, 4)}****${normalized.slice(-4)}`;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderActivationBadge(status: ActivationStatusResponse) {
  if (typeof document === 'undefined' || !status.enabled) return;
  const code = normalizeActivationCode(status.code || readStoredActivationCode());

  let badge = document.getElementById(ACTIVATION_BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = ACTIVATION_BADGE_ID;
    badge.className = 'activation-quota-badge';
    badge.style.position = 'fixed';
    badge.style.right = '16px';
    badge.style.bottom = '16px';
    badge.style.zIndex = '9999';
    badge.style.padding = '10px 12px';
    badge.style.borderRadius = '10px';
    badge.style.fontSize = '12px';
    badge.style.lineHeight = '1.5';
    badge.style.backdropFilter = 'blur(10px)';
    document.body.appendChild(badge);
  }

  badge.innerHTML = `
    <div style="font-weight: 700; color: ${status.disabled ? '#b91c1c' : '#1d4ed8'};">
      激活码余额${status.disabled ? '（已熔断）' : ''}
    </div>
    <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
      <span>当前：${escapeHtml(maskActivationCode(code))}</span>
      <button
        type="button"
        data-activation-action="show-code"
        class="activation-quota-badge__button"
        style="border: 0; border-radius: 6px; padding: 1px 6px; cursor: pointer; font-size: 11px;"
      >查看</button>
    </div>
    <div>Gemini：${status.gemini.remaining}/${status.gemini.limit}</div>
    <div>DeepSeek V4：${status.deepseek.remaining}/${status.deepseek.limit}</div>
  `;
  badge.onclick = async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-activation-action="show-code"]')) return;
    if (!code) {
      window.alert('当前浏览器还没有保存激活码。');
      return;
    }
    try {
      await navigator.clipboard?.writeText(code);
      window.alert(`当前激活码：${code}\n\n已复制到剪贴板。`);
    } catch {
      window.alert(`当前激活码：${code}`);
    }
  };
}

async function refreshActivationStatus() {
  if (shouldBypassActivationPrompt()) {
    removeActivationBadge();
    return;
  }

  const code = readStoredActivationCode();
  if (!code) {
    removeActivationBadge();
    return;
  }

  try {
    const response = await api.post<ActivationStatusResponse>(
      '/blueprint/activation-status',
      {},
      { headers: { 'X-Activation-Code': code } },
    );
    renderActivationBadge(response.data);
  } catch (error) {
    if ((error as any)?.response?.status === 401) {
      clearActivationCode();
    }
    removeActivationBadge();
  }
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
  void refreshActivationStatus();
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
  (response) => {
    if (isAiEndpoint(response.config.url)) {
      void refreshActivationStatus();
    }
    return response;
  },
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

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void refreshActivationStatus();
  }, 500);
}

export interface GenerateWorldSettingDto extends LlmModelSelection {
  outline: string;
  needsUpgradeSystem?: boolean;
  targetMode?: 'microdrama' | 'novel' | 'literature' | 'film';
  microdramaEpisodeCount?: number;
  useRealisticWorldview?: boolean;
  realisticWorldviewContext?: string;
  existingWorldSetting?: string;
  note?: string;
}

export interface GenerateTitleVariantsDto extends LlmModelSelection {
  outline: string;
}

export interface GenerateTitleVariantsResponse {
  success: boolean;
  data: TitleVariant[];
}

export interface GenerateCharactersDto extends LlmModelSelection {
  outline: string;
  worldSetting: string;
  useEnglishNames?: boolean;
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';
  microdramaEpisodeCount?: 15 | 30 | 60 | 100;
  existingCharacters?: string;
  note?: string;
}

export interface GenerateDetailedOutlineDto extends LlmModelSelection {
  outline: string;
  worldSetting: string;
  characters: string;
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';
  microdramaEpisodeCount?: 15 | 30 | 60 | 100;
  outlineBatchIndex?: number;
  outlineStartNumber?: number;
  existingDetailedOutline?: string;
  outlineRevisionSuggestion?: string;
  partialOutlineTargetIndexes?: number[];
  isFinalBatch?: boolean;
  reduceSensitiveContent?: boolean;
}

export interface GenerateMicroStoriesDto extends LlmModelSelection {
  macroStory: string;
  storyIndex: string;
  chapterRange?: string;
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';
  previousMacroStory?: string;
  previousMicroStories?: string;
  nextMacroStory?: string;
}

export interface GenerateMicroStoryVariantsDto extends LlmModelSelection {
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
  mode?: 'novel' | 'microdrama' | 'film';
}

export interface GenerateChapterDto {
  context: string;
  chapterNumber: number;
  unitCount?: number;
  previousEnding?: string;
  savedMicroStories?: any[];
  generatedChapters?: { [key: number]: string };
  nextExistingChapterNumber?: number;
  nextExistingChapterContent?: string;
  mode?: 'novel' | 'microdrama' | 'film';
  writerModelProvider?: WriterModelProvider;
  writerModel?: string;
  actionFirstScript?: boolean;
  dialogueFirstScript?: boolean;
  targetEpisodeWords?: number;
  targetNovelWords?: number;
}

export interface RewriteChapterDto {
  content: string;
  chapterNumber: number;
  targetWords: number;
  adjustmentPercent: number;
  context?: string;
  storyData?: any;
  writerModelProvider?: WriterModelProvider;
  writerModel?: string;
  actionFirstScript?: boolean;
  dialogueFirstScript?: boolean;
  mode?: 'novel' | 'microdrama' | 'film';
}

export interface ReviewMicrodramaScriptsDto {
  chapters: { [key: number]: string };
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  savedMicroStories?: any[];
  model?: string;
}

export interface ReviewMicrodramaScriptsResponse {
  success: boolean;
  data: {
    updatedChapters: { [key: number]: string };
    issues: Array<Record<string, any>>;
    appliedPatches: Array<Record<string, any>>;
    skippedPatches: Array<Record<string, any>>;
    compressedEpisodes?: Array<Record<string, any>>;
    summary: string;
  };
}

export interface GenerateCharacterPromptsDto extends LlmModelSelection {
  episodes: Array<{
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  }>;
  visualStyle?: AssetVisualStyle;
  bookName?: string;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  promptExamples?: string[];
  existingCharacters?: CharacterPromptItem[];
  existingScenes?: ScenePromptItem[];
  existingProps?: PropPromptItem[];
}

export type AssetVisualStyle = 'live_action' | 'guofeng_2d' | 'guofeng_3d';

export interface CharacterPromptItem {
  id?: string;
  name: string;
  aliases?: string[];
  episodeNumbers: number[];
  appearanceLevel: 'core' | 'supporting' | 'cameo';
  matchedFromCharacterSetting: boolean;
  matchConfidence?: number;
  characterSettingExcerpt?: string;
  plotBasis?: string;
  roleBrief?: string;
  visualBrief?: string;
  prompt: string;
  promptNote?: string;
  imageDataUrl?: string;
  imageFileName?: string;
  imageOriginalName?: string;
}

export interface ScenePromptItem {
  id?: string;
  name: string;
  episodeNumber: number;
  episodeNumbers?: number[];
  sceneType: 'primary' | 'secondary' | 'flashback' | 'transition';
  plotBasis?: string;
  sceneBrief: string;
  visualBrief?: string;
  prompt: string;
  promptNote?: string;
  imageDataUrl?: string;
  imageFileName?: string;
  imageOriginalName?: string;
}

export interface PropPromptItem {
  id?: string;
  name: string;
  episodeNumbers: number[];
  propType: 'weapon' | 'token' | 'document' | 'jewelry' | 'vehicle' | 'daily' | 'other';
  reusable: boolean;
  plotBasis?: string;
  propBrief: string;
  visualBrief?: string;
  prompt: string;
  promptNote?: string;
  imageDataUrl?: string;
  imageFileName?: string;
  imageOriginalName?: string;
}

export interface GenerateCharacterPromptsResponse {
  success: boolean;
  data: {
    characters: CharacterPromptItem[];
    scenes?: ScenePromptItem[];
    props?: PropPromptItem[];
    visualStyle?: AssetVisualStyle;
    summary: string;
  };
}

export interface ReviseCharacterPromptDto extends LlmModelSelection {
  character: CharacterPromptItem;
  action: 'regenerate' | 'tune';
  note: string;
  visualStyle?: AssetVisualStyle;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  promptExamples?: string[];
}

export interface GenerateSupplementalAssetPromptDto extends LlmModelSelection {
  assetType: 'character' | 'scene' | 'prop';
  visualStyle: AssetVisualStyle;
  episode: {
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  };
  note: string;
  noPeople?: boolean;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  promptExamples?: string[];
}

export interface SeedanceAssetRef {
  label: string;
  assetType: 'character' | 'scene' | 'prop';
  name: string;
  brief?: string;
  prompt?: string;
}

export interface GenerateSeedancePromptsDto extends LlmModelSelection {
  episode: {
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  };
  visualStyle: AssetVisualStyle;
  assets: SeedanceAssetRef[];
  targetSegmentCount?: number;
  shotsPerSegment?: number;
  promptExample?: string;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
}

export interface SeedancePromptSegment {
  index: number;
  title: string;
  scriptRange?: string;
  assetRefs: string[];
  prompt: string;
}

export interface GenerateSeedancePromptsResponse {
  success: boolean;
  data: {
    segments: SeedancePromptSegment[];
    summary: string;
  };
}

export interface ExportMicrodramaMarkdownDto extends LlmModelSelection {
  chapters: { [key: number]: string };
  bookName: string;
  outline?: any;
  worldSetting?: string;
  characters?: string;
  detailedOutline?: string;
  savedMicroStories?: any[];
}

export const blueprintApi = {
  generateOutline: async (data: GenerateOutlineDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/generate', data);
    return response.data;
  },

  generateTitleVariants: async (data: GenerateTitleVariantsDto): Promise<GenerateTitleVariantsResponse> => {
    const response = await api.post('/blueprint/generate-title-variants', data);
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

  rewriteChapter: async (data: RewriteChapterDto): Promise<GenerateOutlineResponse> => {
    const response = await api.post('/blueprint/rewrite-chapter', data);
    return response.data;
  },

  reviewMicrodramaScripts: async (data: ReviewMicrodramaScriptsDto): Promise<ReviewMicrodramaScriptsResponse> => {
    const response = await api.post('/blueprint/review-microdrama-scripts', data);
    return response.data;
  },

  generateCharacterPrompts: async (data: GenerateCharacterPromptsDto): Promise<GenerateCharacterPromptsResponse> => {
    const response = await api.post('/blueprint/generate-character-prompts', data);
    return response.data;
  },

  reviseCharacterPrompt: async (data: ReviseCharacterPromptDto): Promise<{ success: boolean; data: CharacterPromptItem }> => {
    const response = await api.post('/blueprint/revise-character-prompt', data);
    return response.data;
  },

  generateSupplementalAssetPrompt: async (data: GenerateSupplementalAssetPromptDto): Promise<{ success: boolean; data: { character?: CharacterPromptItem; scene?: ScenePromptItem; prop?: PropPromptItem } }> => {
    const response = await api.post('/blueprint/generate-supplemental-asset-prompt', data);
    return response.data;
  },

  generateSeedancePrompts: async (data: GenerateSeedancePromptsDto): Promise<GenerateSeedancePromptsResponse> => {
    const response = await api.post('/blueprint/generate-seedance-prompts', data);
    return response.data;
  },

  exportMicrodramaMarkdown: async (data: ExportMicrodramaMarkdownDto): Promise<{ success: boolean, data: string, filename: string }> => {
    const response = await api.post('/blueprint/export-microdrama-markdown', data);
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

  getActivationStatus: async (): Promise<ActivationStatusResponse> => {
    const code = readStoredActivationCode() || requestActivationCode();
    const response = await api.post<ActivationStatusResponse>(
      '/blueprint/activation-status',
      {},
      { headers: { 'X-Activation-Code': code } },
    );
    renderActivationBadge(response.data);
    return response.data;
  },

  exportAsDocx: async (data: { chapters: { [key: number]: string }, bookName: string }): Promise<{ success: boolean, data: string, filename: string }> => {
    const response = await api.post('/blueprint/export-docx', data);
    return response.data;
  },
};

export interface CloudProjectsBundle {
  schemaVersion: number;
  updatedAt?: string;
  projects: any[];
  savedOutlines?: any[];
  localState?: {
    writerStateByProjectId?: Record<string, any>;
    generatedChaptersByProjectId?: Record<string, Record<string, string>>;
  };
}

function buildActivationHeaders(promptIfMissing = false) {
  if (shouldBypassActivationPrompt() && !promptIfMissing) {
    return null;
  }
  const storedCode = readStoredActivationCode();
  const code = storedCode || (promptIfMissing ? requestActivationCode('请输入激活码以同步云端项目：') : '');
  if (!code) return null;
  return { 'X-Activation-Code': code };
}

export const cloudProjectApi = {
  hasActivationCode: () => !shouldBypassActivationPrompt() && !!readStoredActivationCode(),

  fetchProjects: async (promptIfMissing = false): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.get<CloudProjectsBundle>('/cloud/projects', { headers });
    return response.data;
  },

  syncProjects: async (bundle: CloudProjectsBundle, promptIfMissing = false): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.post<CloudProjectsBundle>('/cloud/projects/sync', bundle, { headers });
    return response.data;
  },

  saveProject: async (project: any, writerState?: any, promptIfMissing = false): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.post<CloudProjectsBundle>(
      `/cloud/projects/${encodeURIComponent(String(project?.id || ''))}`,
      { project, writerState },
      { headers },
    );
    return response.data;
  },

  saveProjectChapters: async (
    projectId: number | string,
    data: { chapters?: Record<string, string>; deletedChapters?: Array<string | number>; replace?: boolean },
    promptIfMissing = false,
  ): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.post<CloudProjectsBundle>(
      `/cloud/projects/${encodeURIComponent(String(projectId))}/chapters`,
      data,
      { headers },
    );
    return response.data;
  },

  syncOutlines: async (savedOutlines: any[], promptIfMissing = false): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.post<CloudProjectsBundle>(
      '/cloud/projects/outlines/sync',
      { savedOutlines },
      { headers },
    );
    return response.data;
  },

  deleteProject: async (projectId: number | string, promptIfMissing = false): Promise<CloudProjectsBundle | null> => {
    const headers = buildActivationHeaders(promptIfMissing);
    if (!headers) return null;
    const response = await api.delete<CloudProjectsBundle>(
      `/cloud/projects/${encodeURIComponent(String(projectId))}`,
      { headers },
    );
    return response.data;
  },
};

export default api;
