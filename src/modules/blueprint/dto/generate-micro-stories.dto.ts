import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateMicroStoriesDto {
  @IsString()
  @IsNotEmpty()
  macroStory: string; // 中故事内容

  @IsString()
  storyIndex: string; // 中故事序号（如"一"、"二"、"三"）

  @IsString()
  chapterRange?: string; // 章节范围（如"1-20"、"21-40"）
}