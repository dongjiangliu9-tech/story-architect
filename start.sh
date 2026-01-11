#!/bin/bash

echo "🚀 启动故事架构师系统"
echo "========================"

# 检查后端依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装后端依赖..."
    npm install
fi

# 启动后端服务
echo "⚙️  启动后端服务..."
npm run start:dev &
BACKEND_PID=$!

# 等待后端启动
sleep 5

# 检查前端依赖并安装
if [ ! -d "client/node_modules" ]; then
    echo "📦 安装前端依赖..."
    cd client && npm install && cd ..
fi

# 启动前端服务
echo "🎨 启动前端服务..."
cd client && npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ 服务启动完成！"
echo "📱 前端: http://localhost:5173"
echo "🔧 后端: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待用户中断
trap "echo '🛑 正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait