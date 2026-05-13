import { IsNotEmpty, IsString } from 'class-validator';
import { LogicModelSelectionDto } from './logic-model-selection.dto';

export class GenerateTitleVariantsDto extends LogicModelSelectionDto {
  @IsString()
  @IsNotEmpty()
  outline: string;
}
