import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateWorldSettingDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsBoolean()
  @IsOptional()
  needsUpgradeSystem?: boolean;

  @IsBoolean()
  @IsOptional()
  useRealisticWorldview?: boolean;

  @IsString()
  @IsOptional()
  realisticWorldviewContext?: string;

  @IsString()
  @IsOptional()
  existingWorldSetting?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
