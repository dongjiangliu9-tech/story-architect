import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI from 'openai';
import { AI_MODELS, API_CONFIG } from '../../common/constants';

@Injectable()
export class LlmService {
  private logicApiKey: string;
  private logicBaseUrl: string;
  private logicHttpAgent?: HttpsProxyAgent<string>;
  private logicClient: OpenAI; // Gemini 官方 OpenAI 兼容客户端
  private deepseekClient: OpenAI; // Deepseek 官网 API 客户端

  constructor(private configService: ConfigService) {
    this.logicHttpAgent = this.getLogicProxyAgent();
    const deepseekHttpAgent = this.getDeepseekProxyAgent();
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
      maxRetries: 1,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    const client = this.isDeepseekModel(targetModel)
      ? this.deepseekClient
      : this.logicClient;

    const effectiveMaxAttempts = this.isDeepseekModel(targetModel) ? 3 : 4;
    const effectiveRetryDelays = this.isDeepseekModel(targetModel)
      ? [3000, 8000]
      : [5000, 12000, 25000];

    for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
      try {
        console.log(
          `[LLM] 准备调用 model=${targetModel}, attempt=${attempt}/${effectiveMaxAttempts}, openaiCompatible=${!this.isDeepseekModel(targetModel)}`,
        );

        const completion = await client.chat.completions.create({
          messages,
          model: targetModel,
          temperature: this.isDeepseekModel(targetModel) ? 1.2 : 0.7,
          max_tokens: this.isDeepseekModel(targetModel) ? 8192 : undefined,
        });

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
          if (merged) return merged;
        }

        throw new Error('AI 服务返回了空内容，请稍后重试');
      } catch (error) {
        console.error(
          `LLM API Call Failed (attempt ${attempt}/${effectiveMaxAttempts}):`,
          error,
          'Model:',
          targetModel,
        );

        const isRetryable = this.isTimeoutOrGatewayError(error);
        const hasMoreAttempts = attempt < effectiveMaxAttempts;

        if (isRetryable && hasMoreAttempts) {
          const delay = effectiveRetryDelays[attempt - 1] ?? 5000;
          console.warn(`将在 ${delay / 1000} 秒后重试...`);
          await this.sleep(delay);
          continue;
        }

        if (this.isTimeoutOrGatewayError(error)) {
          throw new Error('AI 服务响应超时或上游暂时不可用，请稍后重试');
        }

        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) {
          throw new Error('官方 Gemini API 拒绝访问，请检查 Key、模型权限或账户额度');
        }
        if (status === 404) {
          throw new Error(`模型 ${targetModel} 当前不可用或接口路径不匹配`);
        }
        if (status === 429 || status === 503) {
          throw new Error(
            `官方 Gemini 模型 ${targetModel} 当前高负载，请稍后重试`,
          );
        }

        throw new Error('AI 服务暂时不可用，请稍后重试');
      }
    }

    throw new Error('AI 服务暂时不可用，请稍后重试');
  }

  private isDeepseekModel(model: string): boolean {
    return model.includes('deepseek') || model === this.getWriterModel();
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
  ) {
    try {
      const model = this.getWriterModel();
      const stream = await this.deepseekClient.chat.completions.create({
        messages,
        model,
        temperature: 1.2,
        max_tokens: 8192,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          onChunk(content);
        }
      }
    } catch (error) {
      console.error('Deepseek写作API流式调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
  }

  async chatWithWriterModel(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ) {
    try {
      const model = this.getWriterModel();
      const completion = await this.deepseekClient.chat.completions.create({
        messages,
        model,
        temperature: 1.2,
        max_tokens: 8192,
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Deepseek写作API调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
  }
}
