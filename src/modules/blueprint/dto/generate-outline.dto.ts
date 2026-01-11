import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateOutlineDto {
  @IsString()
  @IsNotEmpty()
  channel: string; // 频道 (例如：起点仙侠)

  @IsString()
  @IsNotEmpty()
  style: string; // 文风 (例如：克苏鲁无限流)

  @IsString()
  @IsNotEmpty()
  theme: string; // 核心主题 (例如：复仇与救赎)
}