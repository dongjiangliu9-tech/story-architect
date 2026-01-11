import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 👇 修复 CORS：不能用 '*'，必须写死允许的前端域名
  app.enableCors({
    origin: [
      'https://www.novelbot.top',      // 你的正式域名
      'https://novelbot.top',          // 不带 www 的也加上
      'http://localhost:5173',         // 本地开发也要加上，否则本地测不了
      'https://story-architect-hazel.vercel.app' // 你的 Vercel 临时域名也加上备用
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
