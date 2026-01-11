import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from './modules/llm/llm.module';
import { BlueprintModule } from './modules/blueprint/blueprint.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // 加载 .env
    LlmModule,
    BlueprintModule,
  ],
})
export class AppModule {}
