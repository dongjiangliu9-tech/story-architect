import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. 允许跨域的白名单 (补全了所有域名)
  app.enableCors({
    origin: [
      'https://www.novelbot.top',       // 你的正式域名 (带www)
      'https://novelbot.top',           // 你的正式域名 (不带www)
      'https://story-architect-eb93.vercel.app', // ⚠️ 新发现：你截图里的 Vercel 实际域名
      'https://story-architect-hazel.vercel.app', // 旧的 Vercel 域名 (留着备用)
      'http://localhost:5173',          // 本地开发
      'http://localhost:3000'           // 本地测试
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // 👇 必须加 '0.0.0.0'，否则 Zeabur 会报 502 错误！
  await app.listen(process.env.PORT || 3000, '0.0.0.0');

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
