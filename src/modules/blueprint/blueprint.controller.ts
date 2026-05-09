import { Body, Controller, Headers, MessageEvent, Post, Query, Sse } from '@nestjs/common';
import { BlueprintService } from './blueprint.service';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { GenerateWorldSettingDto } from './dto/generate-world-setting.dto';
import { GenerateCharactersDto } from './dto/generate-characters.dto';
import { GenerateDetailedOutlineDto } from './dto/generate-detailed-outline.dto';
import { GenerateMicroStoriesDto } from './dto/generate-micro-stories.dto';
import { GenerateMicroStoryVariantsDto } from './dto/generate-micro-story-variants.dto';
import { GenerateChapterDto, RewriteChapterDto } from './dto/generate-chapter.dto';
import { Observable } from 'rxjs';
import { ActivationModelKind, ActivationQuotaService } from '../activation/activation-quota.service';

@Controller('blueprint')
export class BlueprintController {
  constructor(
    private readonly blueprintService: BlueprintService,
    private readonly activationQuotaService: ActivationQuotaService,
  ) {}

  private async runWithQuota<T>(
    code: string | undefined,
    model: ActivationModelKind,
    action: () => Promise<T>,
    options: { refundOnError?: boolean } = { refundOnError: true },
  ): Promise<T> {
    const activationCode = this.activationQuotaService.validateAndConsume(code, model);
    try {
      return await action();
    } catch (error) {
      if (options.refundOnError !== false) {
        this.activationQuotaService.refund(activationCode, model);
      }
      throw error;
    }
  }

  private getWriterQuotaModel(dto: GenerateChapterDto): ActivationModelKind {
    return dto.writerModelProvider === 'gemini' ? 'gemini' : 'deepseek';
  }

  private getRewriteQuotaModel(dto: RewriteChapterDto): ActivationModelKind {
    return dto.writerModelProvider === 'gemini' ? 'gemini' : 'deepseek';
  }

  @Post('generate')
  async generate(@Body() dto: GenerateOutlineDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateInspiration(dto));
  }

  @Post('generate-world-setting')
  async generateWorldSetting(@Body() dto: GenerateWorldSettingDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateWorldSetting(dto));
  }

  @Post('generate-characters')
  async generateCharacters(@Body() dto: GenerateCharactersDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateCharacters(dto));
  }

  @Post('generate-detailed-outline')
  async generateDetailedOutline(@Body() dto: GenerateDetailedOutlineDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateDetailedOutline(dto));
  }

  @Post('generate-micro-stories')
  async generateMicroStories(@Body() dto: GenerateMicroStoriesDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateMicroStories(dto));
  }

  @Post('generate-micro-story-variants')
  async generateMicroStoryVariants(@Body() dto: GenerateMicroStoryVariantsDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, 'gemini', () => this.blueprintService.generateMicroStoryVariants(dto));
  }

  @Post('generate-chapter')
  async generateChapter(@Body() dto: GenerateChapterDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, this.getWriterQuotaModel(dto), () => this.blueprintService.generateChapter(dto));
  }

  @Post('rewrite-chapter')
  async rewriteChapter(@Body() dto: RewriteChapterDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(activationCode, this.getRewriteQuotaModel(dto), () => this.blueprintService.rewriteChapter(dto));
  }

  @Post('prepare-stream')
  async prepareStream(@Body() dto: GenerateChapterDto, @Headers('x-activation-code') activationCode?: string) {
    return this.runWithQuota(
      activationCode,
      this.getWriterQuotaModel(dto),
      async () => {
        console.log('收到准备流式请求，章节:', dto.chapterNumber);
        const requestId = this.blueprintService.storeGenerationRequest(dto);
        console.log('存储请求成功, requestId:', requestId);
        return { requestId };
      },
      { refundOnError: false },
    );
  }

  @Post('cancel-generation')
  async cancelGeneration(@Body() body: { requestId: string }) {
    this.blueprintService.cancelGeneration(body.requestId);
    return { success: true };
  }

  @Sse('generate-chapter-stream')
  async generateChapterStream(@Query('requestId') requestId: string): Promise<Observable<MessageEvent>> {
    console.log('收到SSE流请求, requestId:', requestId);

    const claimed = this.blueprintService.claimGenerationRequest(requestId);
    if (!claimed) {
      console.error('生成请求不存在:', requestId);
      console.log('当前存储的请求数量:', this.blueprintService.getStoredRequestCount());
      throw new Error('生成请求不存在或已过期，请重新开始生成');
    }
    console.log(claimed.alreadyActive ? '生成请求已在运行，接入现有流' : '找到生成请求，开始流式生成');
    return this.blueprintService.generateChapterStream(claimed.dto, requestId);
  }

  @Post('export-docx')
  async exportDocx(@Body() body: { chapters: { [key: number]: string }, bookName: string }) {
    return this.blueprintService.exportAsDocx(body.chapters, body.bookName);
  }

  @Post('activation-status')
  async activationStatus(@Headers('x-activation-code') activationCode?: string) {
    return this.activationQuotaService.getStatus(activationCode);
  }
}
