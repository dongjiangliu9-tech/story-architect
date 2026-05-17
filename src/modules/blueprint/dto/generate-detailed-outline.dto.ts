import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, Min, Max, IsBoolean, IsArray } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateDetailedOutlineDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsString()
  @IsNotEmpty()
  worldSetting: string; // 世界观基础设定内容

  @IsString()
  @IsNotEmpty()
  characters: string; // 人物设定内容

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama', 'literature', 'film'])
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';

  @IsInt()
  @IsIn([15, 30, 60, 100])
  @IsOptional()
  microdramaEpisodeCount?: 15 | 30 | 60 | 100;

  @IsInt()
  @Min(1)
  @Max(99)
  @IsOptional()
  outlineBatchIndex?: number;

  @IsInt()
  @Min(1)
  @Max(999)
  @IsOptional()
  outlineStartNumber?: number;

  @IsString()
  @IsOptional()
  existingDetailedOutline?: string;

  @IsString()
  @IsOptional()
  outlineRevisionSuggestion?: string;

  @IsArray()
  @IsOptional()
  partialOutlineTargetIndexes?: number[];

  @IsBoolean()
  @IsOptional()
  isFinalBatch?: boolean;

  @IsBoolean()
  @IsOptional()
  reduceSensitiveContent?: boolean;
}
