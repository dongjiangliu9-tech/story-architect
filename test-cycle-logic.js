// 测试一键循环生成的核心逻辑
console.log('🧪 开始测试一键循环生成逻辑\n');

// 模拟项目数据
const mockProject = {
  id: 'test-project-123',
  bookName: '测试小说：龙与魔法',
  savedMicroStories: [
    { title: '故事1', content: '内容1...', macroStoryTitle: '中故事1', order: 0 },
    { title: '故事2', content: '内容2...', macroStoryTitle: '中故事1', order: 1 },
    { title: '故事3', content: '内容3...', macroStoryTitle: '中故事2', order: 2 },
    { title: '故事4', content: '内容4...', macroStoryTitle: '中故事2', order: 3 },
    { title: '故事5', content: '内容5...', macroStoryTitle: '中故事3', order: 4 },
    { title: '故事6', content: '内容6...', macroStoryTitle: '中故事3', order: 5 },
    { title: '故事7', content: '内容7...', macroStoryTitle: '中故事4', order: 6 },
  ]
};

// 模拟生成状态
let generatedChapters = {};
let currentBatch = 1;
let isBatchGenerating = false;
let fullCycleProgress = null;

// 模拟批量生成函数
function simulateBatchGeneration() {
  return new Promise((resolve) => {
    console.log(`🔄 模拟生成第${currentBatch}批...`);
    isBatchGenerating = true;

    // 模拟生成8章内容
    const batchSize = 8;
    const startChapter = (currentBatch - 1) * 8 + 1;
    const endChapter = Math.min(startChapter + batchSize - 1, mockProject.savedMicroStories.length * 2);

    setTimeout(() => {
      // 模拟生成章节
      for (let i = startChapter; i <= endChapter; i++) {
        generatedChapters[i] = `第${i}章：测试内容...`;
      }

      console.log(`✅ 第${currentBatch}批生成完成！生成了 ${endChapter - startChapter + 1} 章内容`);

      // 模拟保存和下载
      console.log('💾 自动保存内容...');
      console.log('📥 自动下载TXT文件...');

      isBatchGenerating = false;
      resolve();
    }, 1000); // 模拟1秒生成时间
  });
}

// 测试一键循环生成逻辑
async function testCycleGenerationLogic() {
  console.log('📊 项目信息:');
  console.log(`   书名: ${mockProject.bookName}`);
  console.log(`   小故事数量: ${mockProject.savedMicroStories.length}`);
  console.log(`   总章节数: ${mockProject.savedMicroStories.length * 2}`);

  const totalChapters = mockProject.savedMicroStories.length * 2;
  const totalBatches = Math.ceil(totalChapters / 8);

  console.log(`   总批次数: ${totalBatches} (每批8章)\n`);

  console.log('🚀 开始一键循环生成...\n');

  // 重置状态
  generatedChapters = {};
  currentBatch = 1;
  isBatchGenerating = false;

  // 模拟循环生成
  while (currentBatch <= totalBatches) {
    const chaptersGenerated = (currentBatch - 1) * 8;
    const batchStartChapter = chaptersGenerated + 1;
    const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);

    console.log(`📦 第${currentBatch}/${totalBatches}批: 生成章节 ${batchStartChapter}-${batchEndChapter}`);

    // 模拟用户点击"批量生成8章"按钮
    await simulateBatchGeneration();

    // 更新批次
    currentBatch++;

    console.log(''); // 空行分隔批次
  }

  console.log('🎉 一键循环生成完成！');
  console.log(`📈 最终结果: 生成了 ${Object.keys(generatedChapters).length} 章内容`);
  console.log(`📝 生成的章节: ${Object.keys(generatedChapters).join(', ')}`);

  // 验证结果
  console.log('\n✅ 验证结果:');
  console.log(`   期望章节数: ${totalChapters}`);
  console.log(`   实际生成数: ${Object.keys(generatedChapters).length}`);
  console.log(`   是否完整: ${Object.keys(generatedChapters).length === totalChapters ? '✅' : '❌'}`);

  // 检查章节连续性
  const chapterNumbers = Object.keys(generatedChapters).map(Number).sort((a, b) => a - b);
  const isContinuous = chapterNumbers.every((num, index) => num === index + 1);
  console.log(`   章节连续: ${isContinuous ? '✅' : '❌'}`);

  if (isContinuous && Object.keys(generatedChapters).length === totalChapters) {
    console.log('\n🎊 测试通过！一键循环生成逻辑正确 ✅');
  } else {
    console.log('\n❌ 测试失败！逻辑有问题');
  }
}

// 运行测试
testCycleGenerationLogic().catch(error => {
  console.error('❌ 测试过程中出现错误:', error);
});