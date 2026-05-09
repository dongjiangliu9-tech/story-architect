import { IsIn, IsOptional, IsString } from 'class-validator';

export type LogicModelProvider = 'default' | 'gateway';

export class LogicModelSelectionDto {
  @IsString()
  @IsOptional()
  @IsIn(['default', 'gateway'])
  llmModelProvider?: LogicModelProvider;

  @IsString()
  @IsOptional()
  llmModel?: string;
}
