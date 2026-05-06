import { Module } from '@nestjs/common';
import { BlueprintController } from './blueprint.controller';
import { BlueprintService } from './blueprint.service';
import { ActivationModule } from '../activation/activation.module';

@Module({
  imports: [ActivationModule],
  controllers: [BlueprintController],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}
