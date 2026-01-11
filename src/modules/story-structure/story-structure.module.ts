import { Module } from '@nestjs/common';
import { StoryStructureController } from './story-structure.controller';
import { StoryStructureService } from './story-structure.service';

@Module({
  controllers: [StoryStructureController],
  providers: [StoryStructureService],
  exports: [StoryStructureService],
})
export class StoryStructureModule {}