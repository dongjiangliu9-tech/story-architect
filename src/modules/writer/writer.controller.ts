import { Controller } from '@nestjs/common';
import { WriterService } from './writer.service';

@Controller('writer')
export class WriterController {
  constructor(private readonly writerService: WriterService) {}
}