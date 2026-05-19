import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateMicroStoriesDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  macroStory: string; // 中故事内容

  @IsString()
  storyIndex: string; // 中故事序号（如"一"、"二"、"三"）

  @IsString()
  chapterRange?: string; // 章节范围（如"1-15"、"16-30"）

  @IsString()
  @IsOptional()
  previousMacroStory?: string; // 上一个中故事内容，用于跨中故事衔接

  @IsString()
  @IsOptional()
  previousMicroStories?: string; // 已生成的上一组分集/小故事细纲，用于承接

  @IsString()
  @IsOptional()
  nextMacroStory?: string; // 下一个中故事内容，用于自然递交目标

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama', 'literature', 'film'])
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';
}
