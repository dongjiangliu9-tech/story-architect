# 故事架构师前端

基于 React + TypeScript + Tailwind CSS 的美观网文创作界面。

## 功能特性

- 🎨 **美观UI**: 现代化的渐变背景和卡片设计
- 📱 **响应式**: 支持桌面和移动设备
- ✨ **动画效果**: 平滑的过渡和动态效果
- 🎯 **智能选择**: 基于起点中文网的分类体系
- 🤖 **AI集成**: 与后端API无缝对接

## 技术栈

- **React 18** - 用户界面框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **Lucide React** - 图标库
- **Axios** - HTTP客户端
- **Vite** - 构建工具

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 项目结构

```
src/
├── components/          # UI组件
│   ├── CategorySelector.tsx    # 频道选择器
│   ├── StyleSelector.tsx       # 风格选择器
│   ├── ThemeInput.tsx          # 主题输入
│   ├── GenerateButton.tsx      # 生成按钮
│   ├── OutlineCard.tsx         # 大纲卡片
│   ├── OutlineNavigator.tsx    # 大纲导航
│   └── LoadingSpinner.tsx      # 加载动画
├── data/               # 数据文件
│   └── novelCategories.ts      # 网文分类数据
├── services/           # 服务层
│   └── api.ts                  # API调用
├── types/              # TypeScript类型
│   └── index.ts                # 类型定义
├── utils/              # 工具函数
│   └── outlineParser.ts        # 大纲解析器
└── App.tsx             # 主应用组件
```

## 主要组件

### CategorySelector
- 支持男频/女频切换
- 基于起点分类的频道选择
- 响应式网格布局

### StyleSelector
- 10种不同写作风格
- 包含描述和图标
- 支持多选交互

### OutlineCard
- 美观的大纲展示卡片
- 5个核心模块的可视化
- 渐变背景和动画效果

## API集成

前端通过 `/api` 代理与后端通信：

- `POST /api/blueprint/generate` - 生成故事大纲

## 样式设计

- **色彩方案**: 基于蓝紫色系的主色调
- **字体**: Inter 字体族
- **动画**: CSS动画和过渡效果
- **响应式**: 移动优先的设计理念