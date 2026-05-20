import { IsString, IsNumber, IsOptional, IsArray, IsObject, IsIn, IsBoolean } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export type WriterModelProvider = 'deepseek' | 'gemini' | 'gateway';

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
  @IsIn(['novel', 'microdrama', 'film'])
  mode?: 'novel' | 'microdrama' | 'film';

  @IsString()
  @IsOptional()
  @IsIn(['deepseek', 'gemini', 'gateway'])
  writerModelProvider?: WriterModelProvider;

  @IsString()
  @IsOptional()
  writerModel?: string;

  @IsBoolean()
  @IsOptional()
  actionFirstScript?: boolean;

  @IsBoolean()
  @IsOptional()
  dialogueFirstScript?: boolean;

  @IsNumber()
  @IsOptional()
  targetEpisodeWords?: number;

  @IsNumber()
  @IsOptional()
  targetNovelWords?: number;
}

export class RewriteSelectedSettingSectionDto extends LogicModelSelectionDto {
  @IsString()
  @IsIn(['world', 'characters'])
  section: 'world' | 'characters';

  @IsString()
  fullText: string;

  @IsString()
  selectedText: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  outline?: string;

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;
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
  @IsIn(['deepseek', 'gemini', 'gateway'])
  writerModelProvider?: WriterModelProvider;

  @IsString()
  @IsOptional()
  writerModel?: string;

  @IsBoolean()
  @IsOptional()
  actionFirstScript?: boolean;

  @IsBoolean()
  @IsOptional()
  dialogueFirstScript?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama', 'film'])
  mode?: 'novel' | 'microdrama' | 'film';
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
  @IsIn(['novel', 'microdrama', 'film'])
  mode?: 'novel' | 'microdrama' | 'film';
}

export class ReviewMicrodramaScriptsDto {
  @IsObject()
  chapters: { [key: number]: string };

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;

  @IsArray()
  @IsOptional()
  savedMicroStories?: any[];

  @IsString()
  @IsOptional()
  model?: string;
}

export class GenerateCharacterPromptsDto extends LogicModelSelectionDto {
  @IsArray()
  episodes: Array<{
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  }>;

  @IsString()
  @IsOptional()
  @IsIn(['live_action', 'guofeng_2d', 'guofeng_3d'])
  visualStyle?: 'live_action' | 'guofeng_2d' | 'guofeng_3d';

  @IsString()
  @IsOptional()
  bookName?: string;

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;

  @IsArray()
  @IsOptional()
  promptExamples?: string[];

  @IsArray()
  @IsOptional()
  existingCharacters?: any[];

  @IsArray()
  @IsOptional()
  existingScenes?: any[];

  @IsArray()
  @IsOptional()
  existingProps?: any[];
}

export class ReviseCharacterPromptDto extends LogicModelSelectionDto {
  @IsObject()
  character: any;

  @IsString()
  @IsIn(['regenerate', 'tune'])
  action: 'regenerate' | 'tune';

  @IsString()
  note: string;

  @IsString()
  @IsOptional()
  @IsIn(['live_action', 'guofeng_2d', 'guofeng_3d'])
  visualStyle?: 'live_action' | 'guofeng_2d' | 'guofeng_3d';

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;

  @IsArray()
  @IsOptional()
  promptExamples?: string[];
}

export class GenerateSupplementalAssetPromptDto extends LogicModelSelectionDto {
  @IsString()
  @IsIn(['character', 'scene', 'prop'])
  assetType: 'character' | 'scene' | 'prop';

  @IsString()
  @IsIn(['live_action', 'guofeng_2d', 'guofeng_3d'])
  visualStyle: 'live_action' | 'guofeng_2d' | 'guofeng_3d';

  @IsObject()
  episode: {
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  };

  @IsString()
  note: string;

  @IsBoolean()
  @IsOptional()
  noPeople?: boolean;

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;

  @IsArray()
  @IsOptional()
  promptExamples?: string[];
}

export class GenerateSeedancePromptsDto extends LogicModelSelectionDto {
  @IsObject()
  episode: {
    episode: number;
    content: string;
    outline?: string;
    title?: string;
  };

  @IsString()
  @IsIn(['live_action', 'guofeng_2d', 'guofeng_3d'])
  visualStyle: 'live_action' | 'guofeng_2d' | 'guofeng_3d';

  @IsArray()
  assets: any[];

  @IsNumber()
  @IsOptional()
  targetSegmentCount?: number;

  @IsNumber()
  @IsOptional()
  shotsPerSegment?: number;

  @IsString()
  @IsOptional()
  promptExample?: string;

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;
}

export class ExportMicrodramaMarkdownDto extends LogicModelSelectionDto {
  @IsObject()
  chapters: { [key: number]: string };

  @IsString()
  bookName: string;

  @IsObject()
  @IsOptional()
  outline?: any;

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  detailedOutline?: string;

  @IsArray()
  @IsOptional()
  savedMicroStories?: any[];
}
