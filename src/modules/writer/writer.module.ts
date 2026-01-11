import { Module } from '@nestjs/common';
import { WriterController } from './writer.controller';
import { WriterService } from './writer.service';

@Module({
  controllers: [WriterController],
  providers: [WriterService],
  exports: [WriterService],
})
export class WriterModule {}