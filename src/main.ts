import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const defaultCorsOrigins = [
    'https://www.novelbot.top',
    'https://novelbot.top',
    'https://story-architect-eb93.vercel.app',
    'https://story-architect-hazel.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const corsOrigins = (
    process.env.CORS_ORIGINS?.split(',') || defaultCorsOrigins
  )
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Activation-Code',
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

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  console.log(`[DEBUG] 正在使用端口: ${port} (类型: ${typeof port}) 并监听 0.0.0.0`);

  await app.listen(port, '0.0.0.0');

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
