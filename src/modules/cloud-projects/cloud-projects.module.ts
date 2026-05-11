import { Module } from '@nestjs/common';
import { ActivationModule } from '../activation/activation.module';
import { CloudProjectsController } from './cloud-projects.controller';
import { CloudProjectsService } from './cloud-projects.service';

@Module({
  imports: [ActivationModule],
  controllers: [CloudProjectsController],
  providers: [CloudProjectsService],
})
export class CloudProjectsModule {}
