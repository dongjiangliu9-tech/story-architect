import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export interface MicroStoryVariantTarget {
  index: number;
  title: string;
  content: string;
}

export class GenerateMicroStoryVariantsDto extends LogicModelSelectionDto {
  @IsString()
  macroStory: string;

  @IsString()
  currentTitle: string;

  @IsString()
  currentContent: string;

  @IsString()
  @IsOptional()
  previousContent?: string;

  @IsString()
  @IsOptional()
  nextContent?: string;

  @IsString()
  @IsOptional()
  selectedVariantTitle?: string;

  @IsString()
  @IsOptional()
  selectedVariantContent?: string;

  @IsArray()
  @IsOptional()
  targetStories?: MicroStoryVariantTarget[];

  @IsArray()
  @IsOptional()
  selectedVariantStories?: MicroStoryVariantTarget[];

  @IsString()
  @IsOptional()
  @IsIn(['micro', 'macro'])
  targetType?: 'micro' | 'macro';

  @IsString()
  @IsOptional()
  worldSetting?: string;

  @IsString()
  @IsOptional()
  characters?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  storyIndex?: string;

  @IsString()
  @IsOptional()
  microIndex?: string;

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';
}
