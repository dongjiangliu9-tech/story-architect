import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 👇 核心修复：开启 CORS 允许跨域
  app.enableCors({
    origin: '*', // 允许任何网站访问 (最省事的写法，保证能通)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // 这一行原本应该就有，保持不动
  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
