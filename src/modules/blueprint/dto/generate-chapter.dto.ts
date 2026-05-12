import { IsString, IsNumber, IsOptional, IsArray, IsObject, IsIn, IsBoolean } from 'class-validator';

export class GenerateChapterDto {
  @IsString()
  context: string; // 完整的故事背景信息

  @IsNumber()
  chapterNumber: number; // 章节编号

  @IsNumber()
  @IsOptional()
  unitCount?: number; // 本次要生成的章/集数量

  @IsString()
  @IsOptional()
  previousEnding?: string; // 上一章结尾内容（可选）

  @IsArray()
  @IsOptional()
  savedMicroStories?: any[]; // 保存的小故事数据（可选）

  @IsObject()
  @IsOptional()
  generatedChapters?: { [key: number]: string }; // 已生成的章节内容（可选）

  @IsNumber()
  @IsOptional()
  nextExistingChapterNumber?: number; // 后一章已生成时，用于补空白章节的衔接参考

  @IsString()
  @IsOptional()
  nextExistingChapterContent?: string; // 后一章已生成内容节选（可选）

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';

  @IsString()
  @IsOptional()
  @IsIn(['deepseek', 'gemini'])
  writerModelProvider?: 'deepseek' | 'gemini';

  @IsBoolean()
  @IsOptional()
  actionFirstScript?: boolean;

  @IsNumber()
  @IsOptional()
  targetEpisodeWords?: number;

  @IsNumber()
  @IsOptional()
  targetNovelWords?: number;
}

export class RewriteChapterDto {
  @IsString()
  content: string;

  @IsNumber()
  chapterNumber: number;

  @IsNumber()
  targetWords: number;

  @IsNumber()
  adjustmentPercent: number;

  @IsString()
  @IsOptional()
  context?: string;

  @IsObject()
  @IsOptional()
  storyData?: any;

  @IsString()
  @IsOptional()
  @IsIn(['deepseek', 'gemini'])
  writerModelProvider?: 'deepseek' | 'gemini';

  @IsBoolean()
  @IsOptional()
  actionFirstScript?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';
}

export class ValidateChapterScopeDto {
  @IsString()
  content: string;

  @IsNumber()
  chapterNumber: number;

  @IsObject()
  @IsOptional()
  storyData?: any;

  @IsObject()
  @IsOptional()
  nextStoryData?: any;

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';
}
