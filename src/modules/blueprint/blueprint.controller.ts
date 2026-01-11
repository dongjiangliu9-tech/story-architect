import { Controller, Post, Body, Sse, MessageEvent, Query } from '@nestjs/common';
import { BlueprintService } from './blueprint.service';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { GenerateWorldSettingDto } from './dto/generate-world-setting.dto';
import { GenerateCharactersDto } from './dto/generate-characters.dto';
import { GenerateDetailedOutlineDto } from './dto/generate-detailed-outline.dto';
import { GenerateMicroStoriesDto } from './dto/generate-micro-stories.dto';
import { GenerateChapterDto } from './dto/generate-chapter.dto';
import { Observable } from 'rxjs';

@Controller('blueprint')
export class BlueprintController {
  constructor(private readonly blueprintService: BlueprintService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateOutlineDto) {
    return this.blueprintService.generateInspiration(dto);
  }

  @Post('generate-world-setting')
  async generateWorldSetting(@Body() dto: GenerateWorldSettingDto) {
    return this.blueprintService.generateWorldSetting(dto);
  }

  @Post('generate-characters')
  async generateCharacters(@Body() dto: GenerateCharactersDto) {
    return this.blueprintService.generateCharacters(dto);
  }

  @Post('generate-detailed-outline')
  async generateDetailedOutline(@Body() dto: GenerateDetailedOutlineDto) {
    return this.blueprintService.generateDetailedOutline(dto);
  }

  @Post('generate-micro-stories')
  async generateMicroStories(@Body() dto: GenerateMicroStoriesDto) {
    return this.blueprintService.generateMicroStories(dto);
  }

  @Post('generate-chapter')
  async generateChapter(@Body() dto: GenerateChapterDto) {
    return this.blueprintService.generateChapter(dto);
  }

  @Post('prepare-stream')
  async prepareStream(@Body() dto: GenerateChapterDto) {
    console.log('收到准备流式请求，章节:', dto.chapterNumber);
    const requestId = this.blueprintService.storeGenerationRequest(dto);
    console.log('存储请求成功, requestId:', requestId);
    return { requestId };
  }

  @Post('cancel-generation')
  async cancelGeneration(@Body() body: { requestId: string }) {
    this.blueprintService.cancelGeneration(body.requestId);
    return { success: true };
  }

  @Sse('generate-chapter-stream')
  async generateChapterStream(@Query('requestId') requestId: string): Promise<Observable<MessageEvent>> {
    console.log('收到SSE流请求, requestId:', requestId);

    const dto = this.blueprintService.getGenerationRequest(requestId);
    if (!dto) {
      console.error('生成请求不存在:', requestId);
      console.log('当前存储的请求数量:', this.blueprintService.getStoredRequestCount());
      throw new Error('生成请求不存在或已过期，请重新开始生成');
    }

    console.log('找到生成请求，开始流式生成');
    return this.blueprintService.generateChapterStream(dto);
  }

  @Post('export-docx')
  async exportDocx(@Body() body: { chapters: { [key: number]: string }, bookName: string }) {
    return this.blueprintService.exportAsDocx(body.chapters, body.bookName);
  }
}