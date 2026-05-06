import { Module } from '@nestjs/common';
import { ActivationQuotaService } from './activation-quota.service';

@Module({
  providers: [ActivationQuotaService],
  exports: [ActivationQuotaService],
})
export class ActivationModule {}
