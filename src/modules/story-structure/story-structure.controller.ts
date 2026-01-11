import { Controller } from '@nestjs/common';
import { StoryStructureService } from './story-structure.service';

@Controller('story-structure')
export class StoryStructureController {
  constructor(private readonly storyStructureService: StoryStructureService) {}
}