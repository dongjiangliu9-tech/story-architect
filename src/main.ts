import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 获取Express实例并配置请求大小限制
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(json({ limit: '2mb' })); // 增加到2MB
  expressApp.use(urlencoded({ limit: '2mb', extended: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
