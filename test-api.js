const axios = require('axios');

// 测试API调用的脚本
async function testAPI() {
  console.log('开始测试API调用...');

  try {
    const response = await axios.post('http://localhost:3000/api/blueprint/generate', {
      channel: '玄幻',
      style: '脑洞',
      theme: '复仇与救赎'
    }, {
      timeout: 200000, // 200秒超时
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ API调用成功!');
    console.log('响应数据长度:', response.data.data.length);
    console.log('响应预览:', response.data.data.substring(0, 200) + '...');

  } catch (error) {
    console.error('❌ API调用失败:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('提示: 请确保后端服务器正在运行 (npm run start:dev)');
    }
  }
}

testAPI();