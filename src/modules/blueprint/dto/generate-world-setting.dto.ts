import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateWorldSettingDto {
  @IsString()
  @IsNotEmpty()
  outline: string; // 故事大纲内容
}