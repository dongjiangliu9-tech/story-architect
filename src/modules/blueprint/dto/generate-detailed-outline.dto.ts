import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, Min, Max, IsBoolean } from 'class-validator';

export class GenerateDetailedOutlineDto {
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
  @IsIn(['novel', 'microdrama'])
  mode?: 'novel' | 'microdrama';

  @IsInt()
  @IsIn([15, 30, 60, 100])
  @IsOptional()
  microdramaEpisodeCount?: 15 | 30 | 60 | 100;

  @IsInt()
  @Min(1)
  @Max(4)
  @IsOptional()
  outlineBatchIndex?: number;

  @IsString()
  @IsOptional()
  existingDetailedOutline?: string;

  @IsString()
  @IsOptional()
  outlineRevisionSuggestion?: string;

  @IsBoolean()
  @IsOptional()
  isFinalBatch?: boolean;

  @IsBoolean()
  @IsOptional()
  reduceSensitiveContent?: boolean;
}
