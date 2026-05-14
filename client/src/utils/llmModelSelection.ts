import { LlmModelProvider, LlmModelSelection, WriterModelProvider } from '../types';

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
    description: '智灵网关主模型',
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

export const DEFAULT_WRITER_MODEL_VALUE = 'deepseek:deepseek-v4-pro';

export const WRITER_MODEL_OPTIONS: Array<{
  value: string;
  provider: WriterModelProvider;
  model: string;
  label: string;
  description: string;
}> = [
  {
    value: DEFAULT_WRITER_MODEL_VALUE,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: '官方 DeepSeek 写作接口',
  },
  {
    value: 'gateway:DeepSeek-V4-Pro',
    provider: 'gateway',
    model: 'DeepSeek-V4-Pro',
    label: 'DeepSeek V4 Pro',
    description: '智灵网关',
  },
  {
    value: 'gateway:DeepSeek-V4-Flash',
    provider: 'gateway',
    model: 'DeepSeek-V4-Flash',
    label: 'DeepSeek V4 Flash',
    description: '智灵网关',
  },
  {
    value: 'gateway:gemini-3.1-pro-preview',
    provider: 'gateway',
    model: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    description: '智灵网关',
  },
  {
    value: 'gateway:gpt-5.5',
    provider: 'gateway',
    model: 'gpt-5.5',
    label: 'GPT-5.5',
    description: '智灵网关',
  },
  {
    value: 'gateway:claude-sonnet-4-6',
    provider: 'gateway',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: '智灵网关',
  },
  {
    value: 'gateway:claude-opus-4-6',
    provider: 'gateway',
    model: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    description: '智灵网关',
  },
];

export const getWriterModelOption = (value?: string) => {
  return WRITER_MODEL_OPTIONS.find(option => option.value === value) || WRITER_MODEL_OPTIONS[0];
};

export const toWriterModelRequest = (value?: string) => {
  const option = getWriterModelOption(value);
  return {
    writerModelProvider: option.provider,
    writerModel: option.model,
  };
};

const GATEWAY_MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-series': 'claude-sonnet-4-6',
};

export const normalizeGatewayModelValue = (value: string) => {
  return GATEWAY_MODEL_ALIASES[value] || value;
};

export const toLogicModelRequest = (value?: string): LlmModelSelection => {
  const resolvedValue = value || DEFAULT_LOGIC_MODEL_VALUE;

  if (resolvedValue === OFFICIAL_LOGIC_MODEL_VALUE) {
    return {
      llmModelProvider: 'gateway',
      llmModel: DEFAULT_LOGIC_MODEL_VALUE,
    };
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
