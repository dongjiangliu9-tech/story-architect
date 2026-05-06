import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class GenerateCharactersDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsString()
  @IsNotEmpty()
  worldSetting: string; // 世界观基础设定内容

  @IsString()
  @IsOptional()
  existingCharacters?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
