import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI from 'openai';
import { AI_MODELS, API_CONFIG } from '../../common/constants';

type LlmConcurrencyBucket = 'gemini' | 'deepseek' | 'gateway';
type WriterModelProvider = 'deepseek' | 'gemini' | 'gateway';

@Injectable()
export class LlmService {
  private logicApiKey: string;
  private logicBaseUrl: string;
  private logicHttpAgent?: HttpsProxyAgent<string>;
  private logicClient: OpenAI; // Gemini 官方 OpenAI 兼容客户端
  private deepseekClient: OpenAI; // Deepseek 官网 API 客户端
  private gatewayClient: OpenAI; // 智灵网关 OpenAI 兼容客户端
  private readonly activeLlmCalls: Record<LlmConcurrencyBucket, number> = {
    gemini: 0,
    deepseek: 0,
    gateway: 0,
  };
  private readonly llmQueues: Record<LlmConcurrencyBucket, Array<() => void>> = {
    gemini: [],
    deepseek: [],
    gateway: [],
  };

  constructor(private configService: ConfigService) {
    this.logicHttpAgent = this.getLogicProxyAgent();
    const deepseekHttpAgent = this.getDeepseekProxyAgent();
    const gatewayHttpAgent = this.getGatewayProxyAgent();
    this.logicApiKey =
      this.configService.get<string>('LYRICS_API_KEY') ||
      this.configService.get<string>('GEMINI_API_KEY') ||
      '';
    this.logicBaseUrl =
      this.normalizeOpenAiBaseUrl(
      this.configService.get<string>('LYRICS_BASE_URL') ||
        this.configService.get<string>('GOOGLE_GEMINI_BASE_URL') ||
        API_CONFIG.DEFAULT_BASE_URL,
      ) || API_CONFIG.DEFAULT_BASE_URL;

    this.logicClient = new OpenAI({
      apiKey: this.logicApiKey,
      baseURL: this.logicBaseUrl,
      ...(this.logicHttpAgent ? { httpAgent: this.logicHttpAgent } : {}),
      timeout: 180000,
      maxRetries: 0,
      defaultHeaders: {
        Connection: 'keep-alive',
      },
      dangerouslyAllowBrowser: false,
    });

    this.deepseekClient = new OpenAI({
      apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      baseURL:
        this.configService.get<string>('DEEPSEEK_BASE_URL') ||
        'https://api.deepseek.com',
      ...(deepseekHttpAgent ? { httpAgent: deepseekHttpAgent } : {}),
      timeout: 300000,
      maxRetries: 1,
      defaultHeaders: {
        Connection: 'keep-alive',
      },
      dangerouslyAllowBrowser: false,
    });

    this.gatewayClient = new OpenAI({
      apiKey:
        this.configService.get<string>('GATEWAY_API_KEY') ||
        this.configService.get<string>('ZHILING_GATEWAY_API_KEY') ||
        '',
      baseURL:
        this.normalizeOpenAiBaseUrl(
          this.configService.get<string>('GATEWAY_BASE_URL') ||
            this.configService.get<string>('ZHILING_GATEWAY_BASE_URL') ||
            'https://getways-jumu.zeelin.cn/v1',
        ) || 'https://getways-jumu.zeelin.cn/v1',
      ...(gatewayHttpAgent ? { httpAgent: gatewayHttpAgent } : {}),
      timeout: 300000,
      maxRetries: 0,
      defaultHeaders: {
        Connection: 'keep-alive',
      },
      dangerouslyAllowBrowser: false,
    });
  }

  private getLogicProxyAgent() {
    const proxyUrl =
      this.configService.get<string>('LYRICS_PROXY_URL') ||
      this.configService.get<string>('HTTPS_PROXY') ||
      this.configService.get<string>('HTTP_PROXY');

    if (!proxyUrl) {
      return undefined;
    }

    return new HttpsProxyAgent(proxyUrl, {
      keepAlive: true,
    });
  }

  private getDeepseekProxyAgent() {
    const useProxy =
      this.configService.get<string>('DEEPSEEK_USE_PROXY') === 'true';

    if (!useProxy) {
      return undefined;
    }

    const proxyUrl =
      this.configService.get<string>('DEEPSEEK_PROXY_URL') ||
      this.configService.get<string>('HTTPS_PROXY') ||
      this.configService.get<string>('HTTP_PROXY');

    if (!proxyUrl) {
      return undefined;
    }

    return new HttpsProxyAgent(proxyUrl, {
      keepAlive: true,
    });
  }

  private getGatewayProxyAgent() {
    const useProxy =
      this.configService.get<string>('GATEWAY_USE_PROXY') === 'true' ||
      this.configService.get<string>('ZHILING_GATEWAY_USE_PROXY') === 'true';

    if (!useProxy) {
      return undefined;
    }

    const proxyUrl =
      this.configService.get<string>('GATEWAY_PROXY_URL') ||
      this.configService.get<string>('ZHILING_GATEWAY_PROXY_URL') ||
      this.configService.get<string>('HTTPS_PROXY') ||
      this.configService.get<string>('HTTP_PROXY');

    if (!proxyUrl) {
      return undefined;
    }

    return new HttpsProxyAgent(proxyUrl, {
      keepAlive: true,
    });
  }

  private normalizeOpenAiBaseUrl(rawUrl?: string): string | undefined {
    if (!rawUrl) return rawUrl;

    try {
      const url = new URL(rawUrl);
      const normalizedPath = url.pathname.replace(/\/+$/, '');

      if (url.hostname === 'generativelanguage.googleapis.com') {
        if (normalizedPath === '' || normalizedPath === '/v1beta') {
          url.pathname = '/v1beta/openai';
        }
        return url.toString().replace(/\/$/, '');
      }

      if (normalizedPath === '') {
        url.pathname = '/v1';
      }

      return url.toString().replace(/\/$/, '');
    } catch {
      return rawUrl;
    }
  }

  private isTimeoutOrGatewayError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 524 || status === 504 || status === 502 || status === 503;
  }

  private isRetryableLogicError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    const code = String((error as { code?: string })?.code || '');
    const name = String((error as { name?: string })?.name || '');
    const message = String((error as { message?: string })?.message || '');

    return (
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 524 ||
      /空内容|empty content|empty response/i.test(message) ||
      /timeout|timed out|connection|socket/i.test(`${name} ${message}`) ||
      /ECONNRESET|ETIMEDOUT|ECONNABORTED|ENOTFOUND|EAI_AGAIN/i.test(code)
    );
  }

  private canFallbackLogicModel(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return (
      this.isRetryableLogicError(error) ||
      status === 403 ||
      status === 404
    );
  }

  private getLogicModelCandidates(primaryModel: string): string[] {
    const fallbackRaw =
      this.configService.get<string>('LYRICS_FALLBACK_MODELS') ||
      this.configService.get<string>('GEMINI_FALLBACK_MODELS') ||
      'gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite';

    const candidates = [primaryModel, ...fallbackRaw.split(',')]
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !this.isDeepseekModel(item));

    return Array.from(new Set(candidates));
  }

  private canFallbackGatewayModel(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return (
      this.isRetryableLogicError(error) ||
      status === 403 ||
      status === 404
    );
  }

  private getGatewayModelCandidates(primaryModel: string): string[] {
    const fallbackRaw =
      this.configService.get<string>('GATEWAY_FALLBACK_MODELS') ||
      this.configService.get<string>('ZHILING_GATEWAY_FALLBACK_MODELS') ||
      'claude-sonnet-4-6,gpt-5.5,DeepSeek-V4-Pro,claude-opus-4-6,claude-opus-4-5-20251101';

    const candidates = [primaryModel, ...fallbackRaw.split(',')]
      .map((item) => this.normalizeGatewayModel(item.trim()))
      .filter(Boolean)
      .filter((item) => !/flash/i.test(item));

    return Array.from(new Set(candidates));
  }

  private normalizeGatewayModel(model: string): string {
    const aliases: Record<string, string> = {
      'claude-sonnet-series': 'claude-sonnet-4-6',
    };
    return aliases[model] || model;
  }

  private shouldUseGatewayDefaultTemperature(model: string): boolean {
    return /^gpt-5/i.test(model);
  }

  private getConfigNumber(name: string, fallback: number): number {
    const rawValue = this.configService.get<string>(name);
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getConcurrencyLimit(bucket: LlmConcurrencyBucket): number {
    const defaults: Record<LlmConcurrencyBucket, number> = {
      gemini: 2,
      deepseek: 6,
      gateway: 2,
    };
    return this.getConfigNumber(`LLM_${bucket.toUpperCase()}_CONCURRENCY`, defaults[bucket]);
  }

  private getQueueTimeoutMs(): number {
    return this.getConfigNumber('LLM_QUEUE_TIMEOUT_MS', 15 * 60 * 1000);
  }

  private acquireLlmSlot(bucket: LlmConcurrencyBucket, label: string): Promise<() => void> {
    const limit = this.getConcurrencyLimit(bucket);
    const queueTimeoutMs = this.getQueueTimeoutMs();
    const requestId = `${bucket}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const release = () => {
        this.activeLlmCalls[bucket] = Math.max(0, this.activeLlmCalls[bucket] - 1);
        const next = this.llmQueues[bucket].shift();
        if (next) setImmediate(next);
      };

      const tryAcquire = () => {
        if (settled) return;
        if (this.activeLlmCalls[bucket] >= limit) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.activeLlmCalls[bucket] += 1;
        console.log(
          `[LLM_QUEUE] acquired bucket=${bucket}, label=${label}, active=${this.activeLlmCalls[bucket]}/${limit}, queued=${this.llmQueues[bucket].length}, request=${requestId}`,
        );
        resolve(release);
      };

      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const queue = this.llmQueues[bucket];
        const index = queue.indexOf(tryAcquire);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error(`AI ${label} 排队超过 ${Math.round(queueTimeoutMs / 1000)} 秒，请稍后重试`));
      }, queueTimeoutMs);

      if (this.activeLlmCalls[bucket] < limit) {
        tryAcquire();
        return;
      }

      this.llmQueues[bucket].push(tryAcquire);
      console.warn(
        `[LLM_QUEUE] queued bucket=${bucket}, label=${label}, active=${this.activeLlmCalls[bucket]}/${limit}, queued=${this.llmQueues[bucket].length}, request=${requestId}`,
      );
    });
  }

  private async withLlmSlot<T>(
    bucket: LlmConcurrencyBucket,
    label: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquireLlmSlot(bucket, label);
    try {
      return await action();
    } finally {
      release();
      const limit = this.getConcurrencyLimit(bucket);
      console.log(
        `[LLM_QUEUE] released bucket=${bucket}, label=${label}, active=${this.activeLlmCalls[bucket]}/${limit}, queued=${this.llmQueues[bucket].length}`,
      );
    }
  }

  private getLogicMaxAttempts(modelIndex: number): number {
    if (modelIndex === 0) {
      return this.getConfigNumber('GEMINI_PRIMARY_MAX_ATTEMPTS', 1);
    }

    return this.getConfigNumber('GEMINI_FALLBACK_MAX_ATTEMPTS', 2);
  }

  private getLogicRetryDelays(modelIndex: number): number[] {
    return modelIndex === 0 ? [] : [2000];
  }

  private getLogicRequestTimeoutMs(modelIndex: number): number {
    if (modelIndex === 0) {
      return this.getConfigNumber('GEMINI_PRIMARY_TIMEOUT_MS', 120000);
    }

    return this.getConfigNumber('GEMINI_FALLBACK_TIMEOUT_MS', 120000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractCompletionContent(completion: OpenAI.Chat.Completions.ChatCompletion) {
    const content = completion.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    if (Array.isArray(content)) {
      const merged = content
        .map((item: any) =>
          typeof item === 'string' ? item : String(item?.text || ''),
        )
        .join('')
        .trim();
      if (merged) {
        return merged;
      }
    }

    return '';
  }

  async chatWithGatewayModel(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    model?: string,
  ) {
    const targetModel = this.normalizeGatewayModel(
      model ||
        this.configService.get<string>('GATEWAY_MODEL') ||
        this.configService.get<string>('ZHILING_GATEWAY_MODEL') ||
        'gemini-3.1-pro-preview',
    );

    return this.withLlmSlot('gateway', targetModel, async () => {
    let lastError: unknown;
    const candidateModels = this.getGatewayModelCandidates(targetModel);

    for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex++) {
      const currentModel = candidateModels[modelIndex];
      const maxAttempts = modelIndex === 0
        ? this.getConfigNumber('GATEWAY_PRIMARY_MAX_ATTEMPTS', this.getConfigNumber('GATEWAY_MAX_ATTEMPTS', 2))
        : this.getConfigNumber('GATEWAY_FALLBACK_MAX_ATTEMPTS', 1);
      const requestTimeoutMs = modelIndex === 0
        ? this.getConfigNumber('GATEWAY_TIMEOUT_MS', 180000)
        : this.getConfigNumber('GATEWAY_FALLBACK_TIMEOUT_MS', this.getConfigNumber('GATEWAY_TIMEOUT_MS', 180000));

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[LLM] 准备调用 gateway model=${currentModel}, attempt=${attempt}/${maxAttempts}, fallbackIndex=${modelIndex}/${candidateModels.length - 1}, timeoutMs=${requestTimeoutMs}`,
        );

        const requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
          messages,
          model: currentModel,
        };

        if (!this.shouldUseGatewayDefaultTemperature(currentModel)) {
          requestBody.temperature = 0.7;
        }

        const completion = await this.gatewayClient.chat.completions.create(
          requestBody,
          { timeout: requestTimeoutMs },
        );

        const content = this.extractCompletionContent(completion);
        if (content) {
          if (currentModel !== targetModel) {
            console.warn(`[LLM] 网关主模型 ${targetModel} 不可用，已切换到 ${currentModel}`);
          }
          return content;
        }

        throw new Error('AI 网关返回了空内容，请稍后重试');
      } catch (error) {
        lastError = error;
        console.error(
          `Gateway LLM API Call Failed (model ${currentModel}, attempt ${attempt}/${maxAttempts}):`,
          error,
        );

        if (this.isRetryableLogicError(error) && attempt < maxAttempts) {
          const delay = attempt === 1 ? 3000 : 8000;
          console.warn(`将在 ${delay / 1000} 秒后重试网关模型 ${currentModel}...`);
          await this.sleep(delay);
          continue;
        }

        const hasFallbackModel = modelIndex < candidateModels.length - 1;
        if (hasFallbackModel && this.canFallbackGatewayModel(error)) {
          const nextModel = candidateModels[modelIndex + 1];
          console.warn(`[LLM] 网关模型 ${currentModel} 暂不可用，切换到 ${nextModel}`);
          break;
        }

        if (this.isTimeoutOrGatewayError(error)) {
          throw new Error('AI 网关响应超时或上游暂时不可用，请稍后重试');
        }

        const status = (error as { status?: number })?.status;
        const errorMessage = String((error as { message?: string })?.message || '');
        const errorType = String((error as { type?: string })?.type || '');
        if (
          status === 401 ||
          status === 403 ||
          /无效的令牌|invalid token|unauthorized|forbidden/i.test(errorMessage) ||
          /auth|token|unauthorized|forbidden/i.test(errorType)
        ) {
          throw new Error('AI 网关拒绝访问，请检查网关 Token、模型权限或账户额度');
        }
        if (status === 404) {
          throw new Error(`网关模型 ${currentModel} 当前不可用或接口路径不匹配`);
        }
        if (status === 429 || status === 503) {
          throw new Error(`网关模型 ${currentModel} 当前高负载，请稍后重试`);
        }

        throw new Error('AI 网关暂时不可用，请稍后重试');
      }
    }
    }

    const triedModels = candidateModels.join(' -> ');
    console.error('[LLM] 网关模型不可用:', triedModels, lastError);
    throw new Error(`AI 网关模型当前不可用，已尝试 ${triedModels}，请稍后重试`);
    });
  }

  async chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    model?: string,
  ) {
    const targetModel =
      model ||
      this.configService.get<string>('LYRICS_MODEL') ||
      this.configService.get<string>('GEMINI_MODEL') ||
      AI_MODELS.DEFAULT_MODEL;

    const isDeepseek = this.isDeepseekModel(targetModel);
    if (!isDeepseek) {
      return this.chatWithGatewayModel(messages, targetModel);
    }

    const candidateModels = isDeepseek
      ? [targetModel]
      : this.getLogicModelCandidates(targetModel);
    return this.withLlmSlot(isDeepseek ? 'deepseek' : 'gemini', targetModel, async () => {
    let lastError: unknown;

    for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex++) {
      const currentModel = candidateModels[modelIndex];
      const client = isDeepseek ? this.deepseekClient : this.logicClient;
      const effectiveMaxAttempts = isDeepseek
        ? 3
        : this.getLogicMaxAttempts(modelIndex);
      const effectiveRetryDelays = isDeepseek
        ? [3000, 8000]
        : this.getLogicRetryDelays(modelIndex);
      const requestTimeoutMs = isDeepseek
        ? undefined
        : this.getLogicRequestTimeoutMs(modelIndex);

      for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
        try {
          console.log(
            `[LLM] 准备调用 model=${currentModel}, attempt=${attempt}/${effectiveMaxAttempts}, fallbackIndex=${modelIndex}/${candidateModels.length - 1}, timeoutMs=${requestTimeoutMs ?? 'client-default'}, openaiCompatible=${!isDeepseek}`,
          );

          const completion = await client.chat.completions.create(
            {
              messages,
              model: currentModel,
              temperature: isDeepseek ? 1.2 : 0.7,
              max_tokens: isDeepseek ? 8192 : undefined,
            },
            requestTimeoutMs ? { timeout: requestTimeoutMs } : undefined,
          );

          const content = this.extractCompletionContent(completion);
          if (content) {
            if (currentModel !== targetModel) {
              console.warn(`[LLM] 主模型 ${targetModel} 不可用，已降级使用 ${currentModel}`);
            }
            return content;
          }

          throw new Error('AI 服务返回了空内容，请稍后重试');
        } catch (error) {
          lastError = error;
          console.error(
            `LLM API Call Failed (model ${currentModel}, attempt ${attempt}/${effectiveMaxAttempts}):`,
            error,
          );

          const isRetryable = isDeepseek
            ? this.isTimeoutOrGatewayError(error)
            : this.isRetryableLogicError(error);
          const hasMoreAttempts = attempt < effectiveMaxAttempts;

          if (isRetryable && hasMoreAttempts) {
            const delay = effectiveRetryDelays[attempt - 1] ?? 5000;
            console.warn(`将在 ${delay / 1000} 秒后重试 ${currentModel}...`);
            await this.sleep(delay);
            continue;
          }

          const hasFallbackModel = !isDeepseek && modelIndex < candidateModels.length - 1;
          if (hasFallbackModel && this.canFallbackLogicModel(error)) {
            const nextModel = candidateModels[modelIndex + 1];
            console.warn(`[LLM] ${currentModel} 暂不可用，降级切换到 ${nextModel}`);
            break;
          }

          if (this.isTimeoutOrGatewayError(error)) {
            throw new Error('AI 服务响应超时或上游暂时不可用，请稍后重试');
          }

          const status = (error as { status?: number })?.status;
          if (status === 401 || status === 403) {
            throw new Error('官方 Gemini API 拒绝访问，请检查 Key、模型权限或账户额度');
          }
          if (status === 404) {
            throw new Error(`模型 ${currentModel} 当前不可用或接口路径不匹配`);
          }
          if (status === 429 || status === 503) {
            throw new Error(
              `官方 Gemini 模型 ${currentModel} 当前高负载，请稍后重试`,
            );
          }

          throw new Error('AI 服务暂时不可用，请稍后重试');
        }
      }
    }

    const triedModels = candidateModels.join(' -> ');
    console.error('[LLM] 所有候选模型均不可用:', triedModels, lastError);
    throw new Error(`Gemini 当前高负载，已尝试 ${triedModels}，请稍后重试`);
    });
  }

  private isDeepseekModel(model: string): boolean {
    const normalizedModel = model.toLowerCase();
    return normalizedModel.includes('deepseek') || model === this.getWriterModel();
  }

  private getWriterModel(): string {
    return (
      this.configService.get<string>('WRITER_MODEL') || AI_MODELS.WRITER_MODEL
    );
  }

  async chatWithLogicModel(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ) {
    return this.chat(messages, AI_MODELS.DEFAULT_MODEL);
  }

  async chatWithWriterModelStream(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void,
    provider: WriterModelProvider = 'deepseek',
    model?: string,
    options: { signal?: AbortSignal; isCancelled?: () => boolean } = {},
  ) {
    const throwIfCancelled = () => {
      if (options.signal?.aborted || options.isCancelled?.()) {
        throw new Error('GENERATION_CANCELLED');
      }
    };

    throwIfCancelled();

    if (provider === 'gateway') {
      return this.chatWithGatewayModelStream(messages, onChunk, model, options);
    }

    if (provider === 'gemini') {
      return this.chatWithGatewayModelStream(messages, onChunk, model, options);
    }

    const targetModel = model?.trim() || this.getWriterModel();
    return this.withLlmSlot('deepseek', targetModel, async () => {
    try {
      const stream = await this.deepseekClient.chat.completions.create({
        messages,
        model: targetModel,
        temperature: 1.2,
        max_tokens: 8192,
        stream: true,
      }, options.signal ? { signal: options.signal } : undefined);

      for await (const chunk of stream) {
        throwIfCancelled();
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          onChunk(content);
        }
      }
    } catch (error) {
      if (options.signal?.aborted || options.isCancelled?.() || String((error as Error)?.message || '') === 'GENERATION_CANCELLED') {
        throw new Error('GENERATION_CANCELLED');
      }
      console.error('Deepseek写作API流式调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
    });
  }

  private async chatWithGatewayModelStream(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void,
    model?: string,
    options: { signal?: AbortSignal; isCancelled?: () => boolean } = {},
  ) {
    const throwIfCancelled = () => {
      if (options.signal?.aborted || options.isCancelled?.()) {
        throw new Error('GENERATION_CANCELLED');
      }
    };
    const targetModel = this.normalizeGatewayModel(
      model ||
        this.configService.get<string>('GATEWAY_MODEL') ||
        this.configService.get<string>('ZHILING_GATEWAY_MODEL') ||
        'gemini-3.1-pro-preview',
    );
    const candidateModels = this.getGatewayModelCandidates(targetModel);

    return this.withLlmSlot('gateway', targetModel, async () => {
      let lastError: unknown;

      for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex++) {
        const currentModel = candidateModels[modelIndex];
        let emittedAnyChunk = false;

        try {
          throwIfCancelled();
          console.log(
            `[LLM_STREAM] 准备流式调用 gateway model=${currentModel}, fallbackIndex=${modelIndex}/${candidateModels.length - 1}`,
          );

          const requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
            messages,
            model: currentModel,
            stream: true,
          };

          if (!this.shouldUseGatewayDefaultTemperature(currentModel)) {
            requestBody.temperature = 0.7;
          }

          const stream = await this.gatewayClient.chat.completions.create(
            requestBody,
            options.signal ? { signal: options.signal } : undefined,
          );

          for await (const chunk of stream) {
            throwIfCancelled();
            const content = chunk.choices?.[0]?.delta?.content || '';
            if (content) {
              emittedAnyChunk = true;
              onChunk(content);
            }
          }

          if (emittedAnyChunk) {
            if (currentModel !== targetModel) {
              console.warn(`[LLM_STREAM] 网关主模型 ${targetModel} 不可用，已切换到 ${currentModel}`);
            }
            return;
          }

          throw new Error('AI 网关流式返回了空内容，请稍后重试');
        } catch (error) {
          if (options.signal?.aborted || options.isCancelled?.() || String((error as Error)?.message || '') === 'GENERATION_CANCELLED') {
            throw new Error('GENERATION_CANCELLED');
          }

          lastError = error;
          console.error(`Gateway LLM stream failed (model ${currentModel}):`, error);

          const hasFallbackModel = modelIndex < candidateModels.length - 1;
          if (!emittedAnyChunk && hasFallbackModel && this.canFallbackGatewayModel(error)) {
            const nextModel = candidateModels[modelIndex + 1];
            console.warn(`[LLM_STREAM] 网关流式模型 ${currentModel} 暂不可用，切换到 ${nextModel}`);
            continue;
          }

          if (this.isTimeoutOrGatewayError(error)) {
            throw new Error('AI 网关流式响应超时或上游暂时不可用，请稍后重试');
          }

          const status = (error as { status?: number })?.status;
          if (status === 401 || status === 403) {
            throw new Error('AI 网关拒绝访问，请检查网关 Token、模型权限或账户额度');
          }
          if (status === 404) {
            throw new Error(`网关模型 ${currentModel} 当前不可用或接口路径不匹配`);
          }
          if (status === 429 || status === 503) {
            throw new Error(`网关模型 ${currentModel} 当前高负载，请稍后重试`);
          }

          throw new Error('AI 网关流式写作服务暂时不可用，请稍后重试');
        }
      }

      const triedModels = candidateModels.join(' -> ');
      console.error('[LLM_STREAM] 网关流式模型不可用:', triedModels, lastError);
      throw new Error(`AI 网关流式模型当前不可用，已尝试 ${triedModels}，请稍后重试`);
    });
  }

  async chatWithWriterModel(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    provider: WriterModelProvider = 'deepseek',
    model?: string,
  ) {
    if (provider === 'gateway') {
      return this.chatWithGatewayModel(messages, model);
    }

    if (provider === 'gemini') {
      return this.chatWithGatewayModel(messages, model);
    }

    const targetModel = model?.trim() || this.getWriterModel();
    return this.withLlmSlot('deepseek', targetModel, async () => {
    try {
      const completion = await this.deepseekClient.chat.completions.create({
        messages,
        model: targetModel,
        temperature: 1.2,
        max_tokens: 8192,
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Deepseek写作API调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
    });
  }
}
