import { LlmModelProvider, LlmModelSelection } from '../types';

export const DEFAULT_LOGIC_MODEL_VALUE = 'gemini-3.1-pro-preview';
export const OFFICIAL_LOGIC_MODEL_VALUE = 'default';

export const LOGIC_MODEL_OPTIONS: Array<{
  value: string;
  label: string;
  description: string;
}> = [
  {
    value: DEFAULT_LOGIC_MODEL_VALUE,
    label: 'Gemini 3.1 Pro',
    description: '智灵网关备用',
  },
  {
    value: OFFICIAL_LOGIC_MODEL_VALUE,
    label: 'Gemini 官方',
    description: '保持现有主线路由',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5',
    description: '智灵网关备用',
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: '智灵网关备用',
  },
  {
    value: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    description: '智灵网关备用',
  },
  {
    value: 'claude-opus-4-5-20251101',
    label: 'Claude Opus 4.5',
    description: '智灵网关备用',
  },
  {
    value: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro',
    description: '智灵网关备用',
  },
  {
    value: 'DeepSeek-V4-Flash',
    label: 'DeepSeek V4 Flash',
    description: '智灵网关备用',
  },
  {
    value: 'DeepSeek-V4-Pro',
    label: 'DeepSeek V4 Pro',
    description: '智灵网关备用',
  },
];

const GATEWAY_MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-series': 'claude-sonnet-4-6',
};

export const normalizeGatewayModelValue = (value: string) => {
  return GATEWAY_MODEL_ALIASES[value] || value;
};

export const toLogicModelRequest = (value?: string): LlmModelSelection => {
  const resolvedValue = value || DEFAULT_LOGIC_MODEL_VALUE;

  if (resolvedValue === OFFICIAL_LOGIC_MODEL_VALUE) {
    return { llmModelProvider: 'default' };
  }

  return {
    llmModelProvider: 'gateway',
    llmModel: normalizeGatewayModelValue(resolvedValue),
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
    return normalizeGatewayModelValue(source.preferredLlmModel);
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
    if (!source?.preferredLlmModelProvider && !source?.preferredLlmModel) {
      continue;
    }

    const value = getPreferredLogicModelValue(source);
    if (value) {
      return toLogicModelRequest(value);
    }
  }

  return toLogicModelRequest(DEFAULT_LOGIC_MODEL_VALUE);
};
