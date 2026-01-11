import { Controller } from '@nestjs/common';
import { WorldSettingService } from './world-setting.service';

@Controller('world-setting')
export class WorldSettingController {
  constructor(private readonly worldSettingService: WorldSettingService) {}
}