<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

故事架构师 (Story Architect) - 一个基于 NestJS 的网文创作辅助系统，提供智能的故事大纲生成和灵感架构服务。

### 功能特性

- 🧠 **智能灵感生成**: 基于先进的Prompt工程，一次性生成5组风格迥异的标准化故事架构
- 📚 **资深架构师**: 内置"资深网文架构师"角色，拒绝平庸套路，提供高价值创意
- 🎯 **商业价值**: 兼顾文学深度和商业价值，打造有长久生命力的作品
- 🔧 **模块化设计**: 采用NestJS框架，支持模块化扩展

### 系统架构

```
src/
├── app.module.ts            # 主模块
├── main.ts                  # 入口文件
├── common/                  # 通用库
│   ├── constants/           # 存放故事蓝图系统的静态数据
│   └── prompts/             # 存放所有 Prompt 模板
├── modules/
│   ├── llm/                 # LLM 基础服务 (封装 Yinli API)
│   ├── blueprint/           # 界面一：大纲与灵感生成
│   ├── world-setting/       # 界面二：人设与世界观 (预留)
│   ├── story-structure/     # 界面三/四：中/小故事卡拆解 (预留)
│   └── writer/              # 界面五：DeepSeek 写作 (预留)
└── utils/                   # 工具函数
```

## 环境配置

### 环境变量

创建 `.env` 文件并配置以下环境变量：

```bash
# API Configuration
LYRICS_API_KEY=your_google_ai_studio_key_here                     # Google AI Studio / Gemini API Key
LYRICS_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LYRICS_MODEL=gemini-3.1-pro-preview                               # 默认逻辑模型 (Gemini 官方接口)
GEMINI_FALLBACK_MODELS=gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite # Pro 高负载/超时时自动降级
HTTPS_PROXY=http://127.0.0.1:7897                                 # 可选：本地 Clash / HTTP 代理
HTTP_PROXY=http://127.0.0.1:7897                                  # 可选：本地 Clash / HTTP 代理
DEEPSEEK_USE_PROXY=false

# Deepseek Official API (用于写作功能)
DEEPSEEK_API_KEY=your_deepseek_api_key_here                          # Deepseek官网API密钥
WRITER_MODEL=deepseek-v4-pro                                           # 写作模型 (Deepseek官网)

# Server Configuration
PORT=3000                                                              # 服务器端口
```

### 配置模板

复制上面的配置到你的 `.env` 文件中，并根据需要修改API密钥。

## 快速开始

### 一键启动

```bash
# 克隆项目后，一键启动前端和后端
./start.sh
```

访问地址：
- 🎨 **前端界面**: http://localhost:5173
- 🔧 **后端API**: http://localhost:3000

### 手动启动

```bash
# 后端
npm install
npm run start:dev

# 前端 (新终端)
cd client
npm install
npm run dev
```

## 🎨 前端界面

基于 React + TypeScript + Tailwind CSS 的现代化界面，包含：

### 核心功能
- **智能分类**: 基于起点中文网的男频/女频分类体系
- **风格选择**: 10种不同写作风格（脑洞、无限流、热血等）
- **主题输入**: 核心主题和情感表达
- **AI生成**: 一键生成5组标准化故事架构
- **美观展示**: 卡片式大纲展示，支持切换浏览
- **保存收藏**: 可保存喜欢的故事架构到本地
- **导出功能**: 支持导出单个架构或批量导出所有保存内容

### 界面布局
- **左侧面板**: 频道选择、风格配置、主题输入
- **右侧区域**: 大纲卡片展示和导航控制
- **顶部导航**: 保存管理按钮
- **响应式设计**: 支持桌面和移动设备

### 保存功能
- **一键保存**: 在大纲卡片底部点击"保存"按钮
- **本地存储**: 保存内容存储在浏览器本地存储中
- **保存管理**: 点击顶部"我的保存"按钮查看所有保存的架构
- **导出功能**: 支持导出为JSON格式文件
- **状态提示**: 保存成功后显示确认状态

### 故障排除
如果保存后在"我的保存"中找不到内容：
1. **检查浏览器控制台**: 查看是否有保存相关的日志输出
2. **检查localStorage**: 在浏览器开发者工具中查看Application > Local Storage
3. **清除缓存**: 如果有问题，可以清除localStorage数据重新开始
4. **刷新页面**: 有时候状态更新可能需要页面刷新

### 依赖安装

```bash
$ npm install
```

## API 接口

### 生成故事灵感

**POST** `/blueprint/generate`

使用 Gemini 3 Pro 模型生成基于频道、文风和核心主题的5组详细的故事架构。

**请求体：**
```json
{
  "channel": "起点仙侠",
  "style": "克苏鲁无限流",
  "theme": "复仇与救赎"
}
```

**响应：**
```json
{
  "success": true,
  "data": "# 5个详细的灵感架构内容"
}
```

**每个架构包含：**
- 核心概念（详细的故事背景和目标）
- 人物关系（主角与反派的详细设定）
- 世界观设定（独特的游戏/世界规则）
- 主要冲突（核心矛盾和升级机制）
- 金手指设定（主角的独特能力）

**超时处理：**
- 前端超时：200秒
- 后端超时：180秒
- 重试次数：1次
- 如果AI调用超时，将自动返回备选内容

## 🔧 故障排除

### 超时问题解决方案

如果遇到 "timeout of 60000ms exceeded" 错误：

1. **检查网络连接**: 确保能够访问 Yinli API (https://yinli.one)
2. **环境变量**: 确认 `.env` 文件配置正确
3. **超时设置**: 系统已优化超时设置 (前端200秒，后端180秒)
4. **备选方案**: 如果AI调用失败，系统会自动返回备选内容

### 常见问题

**Q: 生成时间过长怎么办？**
A: 系统已优化Prompt和超时设置，如果仍然超时，会自动使用备选内容。

**Q: 如何修改超时时间？**
A: 在 `client/src/services/api.ts` 修改axios超时，在 `src/modules/llm/llm.service.ts` 修改OpenAI超时。

**Q: 如何测试API？**
A: 使用 `./start.sh` 启动服务，或分别启动前后端。

### 技术栈

#### 后端
- **AI 模型**: Gemini 3 Pro (via Yinli API) - 用于逻辑推理和架构设计
- **写作模型**: DeepSeek Chat - 预留用于后续写作功能
- **框架**: NestJS + TypeScript
- **验证**: class-validator + class-transformer
- **API 客户端**: OpenAI SDK (超时180秒，重试1次)

#### 前端
- **框架**: React 18 + TypeScript
- **样式**: Tailwind CSS + 自定义动画
- **图标**: Lucide React
- **HTTP**: Axios (超时200秒)
- **构建**: Vite

## 开发与运行

```bash
# 开发模式
$ npm run start:dev

# 生产模式
$ npm run start:prod

# 构建
$ npm run build
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
