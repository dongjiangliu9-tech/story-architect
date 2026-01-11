import { IsString, IsNumber, IsOptional, IsArray, IsObject } from 'class-validator';

export class GenerateChapterDto {
  @IsString()
  context: string; // 完整的故事背景信息

  @IsNumber()
  chapterNumber: number; // 章节编号

  @IsString()
  @IsOptional()
  previousEnding?: string; // 上一章结尾内容（可选）

  @IsArray()
  @IsOptional()
  savedMicroStories?: any[]; // 保存的小故事数据（可选）

  @IsObject()
  @IsOptional()
  generatedChapters?: { [key: number]: string }; // 已生成的章节内容（可选）
}