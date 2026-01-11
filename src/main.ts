import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. 允许跨域
  app.enableCors({
    origin: [
      'https://www.novelbot.top',
      'https://novelbot.top',
      'https://story-architect-eb93.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000'
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
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
