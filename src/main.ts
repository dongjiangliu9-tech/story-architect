import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. 允许跨域
  app.enableCors({
    origin: [
      'https://www.novelbot.top',           // 国内域名 (带www)
      'https://novelbot.top',               // 国内域名 (不带www)
      'https://story-architect-eb93.vercel.app', // Vercel 前端域名
      'https://novelbot.zeabur.app',        // ⚠️ Zeabur 后端域名 - 新增！
      'http://localhost:5173',              // 本地开发
      'http://localhost:3000'               // 本地测试
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // 配置body-parser以支持大请求体（64章+小故事数据）
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // 增加请求体的最大大小限制到10MB
  const bodyParser = require('body-parser');
  expressApp.use(bodyParser.json({ limit: '10mb' }));
  expressApp.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  app.setGlobalPrefix('api');

  // 👇 核心修复：加个 parseInt() 强制转成数字
  // 只有转成数字，app.listen 才会把它当成端口，否则会被当成文件名！
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  console.log(`[DEBUG] 正在使用端口: ${port} (类型: ${typeof port}) 并监听 0.0.0.0`);

  await app.listen(port, '0.0.0.0');

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
