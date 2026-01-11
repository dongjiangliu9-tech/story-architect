import { IsString, IsNotEmpty } from 'class-validator';

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
}