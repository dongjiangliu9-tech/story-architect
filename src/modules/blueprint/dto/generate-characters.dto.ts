import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
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
  existingCharacters?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
