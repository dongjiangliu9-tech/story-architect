import { LlmModelProvider, LlmModelSelection } from '../types';

export const DEFAULT_LOGIC_MODEL_VALUE = 'default';

export const LOGIC_MODEL_OPTIONS: Array<{
  value: string;
  label: string;
  description: string;
}> = [
  {
    value: DEFAULT_LOGIC_MODEL_VALUE,
    label: 'Gemini 官方',
    description: '保持现有主线路由',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5',
    description: '智灵网关备用',
  },
  {
    value: 'claude-sonnet-series',
    label: 'Claude Sonnet',
    description: '智灵网关备用',
  },
  {
    value: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro',
    description: '智灵网关备用',
  },
];

export const toLogicModelRequest = (value?: string): LlmModelSelection => {
  if (!value || value === DEFAULT_LOGIC_MODEL_VALUE) {
    return { llmModelProvider: 'default' };
  }

  return {
    llmModelProvider: 'gateway',
    llmModel: value,
  };
};

export const toPreferredLogicModelFields = (value?: string) => {
  const selection = toLogicModelRequest(value);
  return {
    preferredLlmModelProvider: selection.llmModelProvider as LlmModelProvider,
    preferredLlmModel: selection.llmModel,
  };
};

export const getPreferredLogicModelValue = (
  source?: {
    preferredLlmModelProvider?: LlmModelProvider;
    preferredLlmModel?: string;
  } | null,
) => {
  if (source?.preferredLlmModelProvider === 'gateway' && source.preferredLlmModel) {
    return source.preferredLlmModel;
  }

  return DEFAULT_LOGIC_MODEL_VALUE;
};

export const getLogicModelRequestFromSources = (
  ...sources: Array<{
    preferredLlmModelProvider?: LlmModelProvider;
    preferredLlmModel?: string;
  } | null | undefined>
): LlmModelSelection => {
  for (const source of sources) {
    const value = getPreferredLogicModelValue(source);
    if (value !== DEFAULT_LOGIC_MODEL_VALUE) {
      return toLogicModelRequest(value);
    }
  }

  return toLogicModelRequest(DEFAULT_LOGIC_MODEL_VALUE);
};
