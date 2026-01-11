import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. 允许跨域 - 简化配置
  app.enableCors({
    origin: [
      'https://www.novelbot.top',           // 国内域名 (带www)
      'https://novelbot.top',               // 国内域名 (不带www)
      'https://story-architect-eb93.vercel.app', // Vercel 前端域名
      'http://localhost:5173',              // 本地开发
      'http://localhost:3000'               // 本地测试
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.setGlobalPrefix('api');

  // 2. 这里的 PORT 必须大写，和 Zeabur 变量一致
  const port = process.env.PORT || 3000;

  // 👇 调试暗号：看日志里有没有这句话
  console.log(`[DEBUG] 正在尝试绑定端口: ${port} 并监听 0.0.0.0`);

  // 3. 核心修复：必须加上 '0.0.0.0'
  await app.listen(port, '0.0.0.0');

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
