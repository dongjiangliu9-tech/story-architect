import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsIn, IsInt } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateCharactersDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsString()
  @IsNotEmpty()
  worldSetting: string; // 世界观基础设定内容

  @IsBoolean()
  @IsOptional()
  useEnglishNames?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['novel', 'microdrama', 'literature', 'film'])
  mode?: 'novel' | 'microdrama' | 'literature' | 'film';

  @IsInt()
  @IsIn([15, 30, 60, 100])
  @IsOptional()
  microdramaEpisodeCount?: 15 | 30 | 60 | 100;

  @IsString()
  @IsOptional()
  existingCharacters?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
