import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './modules/llm/llm.module';
import { BlueprintModule } from './modules/blueprint/blueprint.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // 加载 .env
    LlmModule,
    BlueprintModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
