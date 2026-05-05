import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class GenerateWorldSettingDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsBoolean()
  @IsOptional()
  needsUpgradeSystem?: boolean;
}
