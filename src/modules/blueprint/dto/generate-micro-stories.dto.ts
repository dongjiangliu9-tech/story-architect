import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateMicroStoriesDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  macroStory: string; // 中故事内容

  @IsString()
  storyIndex: string; // 中故事序号（如"一"、"二"、"三"）

  @IsString()
  chapterRange?: string; // 章节范围（如"1-20"、"21-40"）

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';
}
