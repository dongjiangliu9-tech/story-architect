import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AI_MODELS } from '../../common/constants';

@Injectable()
export class LlmService {
  private yinliClient: OpenAI; // 引力API客户端
  private deepseekClient: OpenAI; // Deepseek官网API客户端

  constructor(private configService: ConfigService) {
    // 引力API客户端（用于逻辑推理）
    this.yinliClient = new OpenAI({
      apiKey: this.configService.get<string>('LYRICS_API_KEY'),
      baseURL: this.configService.get<string>('LYRICS_BASE_URL'),
      timeout: 180000, // 180秒超时，给足够的时间
      maxRetries: 1, // 减少重试次数，避免额外延迟
      defaultHeaders: {
        'Connection': 'keep-alive',
      },
      // 禁用默认的请求超时，让我们自己控制
      dangerouslyAllowBrowser: false,
    });

    // Deepseek官网API客户端（用于写作）
    this.deepseekClient = new OpenAI({
      apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      baseURL: 'https://api.deepseek.com/v1',
      timeout: 300000, // 300秒超时，给写作足够时间
      maxRetries: 1,
      defaultHeaders: {
        'Connection': 'keep-alive',
      },
      dangerouslyAllowBrowser: false,
    });
  }

  /** 是否为可重试的超时类错误（524 Cloudflare / 504 Gateway） */
  private isTimeoutOrGatewayError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 524 || status === 504;
  }

  /** 延时（毫秒） */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 通用文本生成方法（对 524/504 自动重试）
   * @param messages 消息数组
   * @param model 可选，覆盖默认模型
   */
  async chat(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], model?: string) {
    const targetModel = model || this.configService.get<string>('LYRICS_MODEL') || AI_MODELS.DEFAULT_MODEL;

    // 选择合适的客户端
    const client = this.isDeepseekModel(targetModel) ? this.deepseekClient : this.yinliClient;

    const maxAttempts = 3;
    const retryDelays = [3000, 8000]; // 第 1、2 次失败后等待再重试

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          messages,
          model: targetModel,
          temperature: 0.7, // 保持一定的创造性
          max_tokens: this.isDeepseekModel(targetModel) ? 8192 : undefined, // Deepseek设置最大token
        });

        return completion.choices[0].message.content;
      } catch (error) {
        console.error(`LLM API Call Failed (attempt ${attempt}/${maxAttempts}):`, error, 'Model:', targetModel);

        const isRetryable = this.isTimeoutOrGatewayError(error);
        const hasMoreAttempts = attempt < maxAttempts;

        if (isRetryable && hasMoreAttempts) {
          const delay = retryDelays[attempt - 1] ?? 5000;
          console.warn(`将在 ${delay / 1000} 秒后重试...`);
          await this.sleep(delay);
          continue;
        }

        if (this.isTimeoutOrGatewayError(error)) {
          throw new Error('AI 服务响应超时（网络或代理超时），请稍后重试');
        }
        throw new Error('AI 服务暂时不可用，请稍后重试');
      }
    }

    throw new Error('AI 服务暂时不可用，请稍后重试');
  }

  /**
   * 判断是否为Deepseek模型
   */
  private isDeepseekModel(model: string): boolean {
    return model.includes('deepseek') || model === AI_MODELS.WRITER_MODEL;
  }

  /**
   * 使用默认逻辑模型 (Gemini 3 Pro) 进行推理
   * @param messages 消息数组
   */
  async chatWithLogicModel(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    return this.chat(messages, AI_MODELS.DEFAULT_MODEL);
  }

  /**
   * 使用写作模型 (DeepSeek官网) 进行创作 - 流式版本
   * @param messages 消息数组
   * @param onChunk 流式输出回调函数
   */
  async chatWithWriterModelStream(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void
  ) {
    try {
      const stream = await this.deepseekClient.chat.completions.create({
        messages,
        model: AI_MODELS.WRITER_MODEL,
        temperature: 1.2, // 写作时稍微提高创造性
        max_tokens: 8192, // 设置最大输出token
        stream: true, // 启用流式输出
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          onChunk(content); // 实时回调每个字符块
        }
      }
    } catch (error) {
      console.error('Deepseek写作API流式调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
  }

  /**
   * 使用写作模型 (DeepSeek官网) 进行创作
   * @param messages 消息数组
   */
  async chatWithWriterModel(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    try {
      const completion = await this.deepseekClient.chat.completions.create({
        messages,
        model: AI_MODELS.WRITER_MODEL,
        temperature: 1.2, // 写作时稍微提高创造性
        max_tokens: 8192, // 设置最大输出token
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Deepseek写作API调用失败:', error);
      throw new Error('Deepseek写作服务暂时不可用，请稍后重试');
    }
  }
}