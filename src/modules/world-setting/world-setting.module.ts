import { Module } from '@nestjs/common';
import { WorldSettingController } from './world-setting.controller';
import { WorldSettingService } from './world-setting.service';

@Module({
  controllers: [WorldSettingController],
  providers: [WorldSettingService],
  exports: [WorldSettingService],
})
export class WorldSettingModule {}