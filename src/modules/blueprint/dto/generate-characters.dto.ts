import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateCharactersDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容

  @IsString()
  @IsNotEmpty()
  worldSetting: string; // 世界观基础设定内容
}