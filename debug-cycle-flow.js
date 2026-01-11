// Debug一键循环生成的完整流程
console.log('🔍 开始Debug一键循环生成流程\n');

// 模拟项目数据
const mockProject = {
  id: 'debug-project',
  bookName: 'Debug小说',
  savedMicroStories: [
    { title: '故事1', content: '内容1', macroStoryTitle: '中1', order: 0 },
    { title: '故事2', content: '内容2', macroStoryTitle: '中1', order: 1 },
    { title: '故事3', content: '内容3', macroStoryTitle: '中2', order: 2 },
    { title: '故事4', content: '内容4', macroStoryTitle: '中2', order: 3 },
    { title: '故事5', content: '内容5', macroStoryTitle: '中3', order: 4 },
    { title: '故事6', content: '内容6', macroStoryTitle: '中3', order: 5 },
    { title: '故事7', content: '内容7', macroStoryTitle: '中4', order: 6 },
    { title: '故事8', content: '内容8', macroStoryTitle: '中4', order: 7 },
    { title: '故事9', content: '内容9', macroStoryTitle: '中5', order: 8 },
    { title: '故事10', content: '内容10', macroStoryTitle: '中5', order: 9 }
  ]
};

// 全局状态
let generatedChapters = {};
let isBatchGenerating = false;
let currentBatch = 1;
let fullCycleProgress = null;

// 模拟API调用 - 关键是这里需要正确计算起始章节
function mockApiCall(startChapter, batchSize) {
  return new Promise((resolve) => {
    console.log(`📡 API调用: 生成章节 ${startChapter} 到 ${startChapter + batchSize - 1}`);

    setTimeout(() => {
      const result = {};
      for (let i = 0; i < batchSize; i++) {
        const chapterNum = startChapter + i;
        result[chapterNum] = `第${chapterNum}章：模拟生成的内容...`;
      }
      resolve(result);
    }, 1000);
  });
}

// 模拟批量生成函数
async function simulateBatchGeneration() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🎯 开始批量生成 - 当前批次: ${currentBatch}`);
      isBatchGenerating = true;

      // 【关键】计算起始章节 - 这里是问题的核心
      const existingChapters = Object.keys(generatedChapters).length;
      const startChapter = existingChapters > 0
        ? Math.max(...Object.keys(generatedChapters).map(Number)) + 1
        : 1;

      console.log(`📊 计算结果:`);
      console.log(`   已生成章节数: ${existingChapters}`);
      console.log(`   已生成的章节: [${Object.keys(generatedChapters).join(', ')}]`);
      console.log(`   计算的起始章节: ${startChapter}`);

      const batchSize = Math.min(8, mockProject.savedMicroStories.length * 2 - existingChapters);
      console.log(`   本批次大小: ${batchSize}章`);

      // 调用API
      const result = await mockApiCall(startChapter, batchSize);

      // 更新全局状态
      generatedChapters = { ...generatedChapters, ...result };

      console.log(`✅ 本批次生成完成:`);
      console.log(`   新生成的章节: [${Object.keys(result).join(', ')}]`);
      console.log(`   总章节数更新为: ${Object.keys(generatedChapters).length}`);

      isBatchGenerating = false;
      resolve();

    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      isBatchGenerating = false;
      reject(error);
    }
  });
}

// Debug版本的generateFullCycleContent
async function debugGenerateFullCycleContent() {
  console.log('🚀 开始Debug一键循环生成\n');

  const microStoriesToUse = mockProject.savedMicroStories;
  const totalChapters = microStoriesToUse.length * 2; // 每个小故事2章
  const totalBatches = Math.ceil(totalChapters / 8);

  console.log(`📋 项目信息:`);
  console.log(`   小故事数量: ${microStoriesToUse.length}`);
  console.log(`   总章节数: ${totalChapters}`);
  console.log(`   总批次数: ${totalBatches} (每批8章)\n`);

  // 初始化状态
  generatedChapters = {};
  currentBatch = 1;
  isBatchGenerating = false;

  try {
    // 【关键循环逻辑】
    while (currentBatch <= totalBatches) {
      console.log(`\n🔄 ===== 第${currentBatch}批循环开始 =====`);

      const chaptersGenerated = (currentBatch - 1) * 8;
      const batchStartChapter = chaptersGenerated + 1;
      const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);

      console.log(`🎯 批次信息:`);
      console.log(`   批次编号: ${currentBatch}/${totalBatches}`);
      console.log(`   计划生成: 章节 ${batchStartChapter}-${batchEndChapter}`);
      console.log(`   当前generatedChapters: [${Object.keys(generatedChapters).join(', ')}]`);

      // 等待批量生成完成
      await simulateBatchGeneration();

      console.log(`📈 批次${currentBatch}完成后的状态:`);
      console.log(`   generatedChapters: [${Object.keys(generatedChapters).join(', ')}]`);
      console.log(`   总生成数: ${Object.keys(generatedChapters).length}/${totalChapters}`);

      // 【关键】更新批次计数器
      currentBatch++;

      console.log(`⏭️  准备进入下一批: currentBatch = ${currentBatch}`);
    }

    console.log('\n🎉 一键循环生成完成！');
    console.log(`📊 最终结果: ${Object.keys(generatedChapters).length} 章`);

    // 验证结果
    const expected = Array.from({length: totalChapters}, (_, i) => i + 1);
    const actual = Object.keys(generatedChapters).map(Number).sort((a, b) => a - b);
    const isComplete = expected.every(num => actual.includes(num));

    console.log(`\n🔍 验证:`);
    console.log(`   期望: [${expected.join(', ')}]`);
    console.log(`   实际: [${actual.join(', ')}]`);
    console.log(`   完整性: ${isComplete ? '✅' : '❌'}`);

  } catch (error) {
    console.error('❌ 循环生成失败:', error);
  }
}

// 运行Debug
debugGenerateFullCycleContent();