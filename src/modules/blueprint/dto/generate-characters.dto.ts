import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class GenerateCharactersDto {
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
