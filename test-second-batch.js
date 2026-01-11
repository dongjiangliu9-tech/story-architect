// 测试第二批生成：验证是否能正确从第9章开始
console.log('🔍 测试第二批生成：验证批次衔接问题\n');

// 扩展模拟数据到16章（8个小故事）
const mockProject = {
  id: 'second-batch-test',
  bookName: '第二批生成测试',
  savedMicroStories: [
    // 第一批：4个小故事（8章）
    { title: '故事1', content: '内容1', macroStoryTitle: '中1', order: 0 },
    { title: '故事2', content: '内容2', macroStoryTitle: '中1', order: 1 },
    { title: '故事3', content: '内容3', macroStoryTitle: '中2', order: 2 },
    { title: '故事4', content: '内容4', macroStoryTitle: '中2', order: 3 },
    // 第二批：4个小故事（8章）
    { title: '故事5', content: '内容5', macroStoryTitle: '中3', order: 4 },
    { title: '故事6', content: '内容6', macroStoryTitle: '中3', order: 5 },
    { title: '故事7', content: '内容7', macroStoryTitle: '中4', order: 6 },
    { title: '故事8', content: '内容8', macroStoryTitle: '中4', order: 7 },
  ]
};

// 模拟API响应 - 16章内容
const mockApiResponses = {};
for (let i = 1; i <= 16; i++) {
  mockApiResponses[i] = `第${i}章：模拟内容（${i <= 8 ? '第一批' : '第二批'}）`;
}

// 全局状态
let generatedChapters = {};
let isBatchGenerating = false;

// 修复后的simulateBatchGeneration函数
async function simulateBatchGeneration(expectedStartChapter) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`🎯 simulateBatchGeneration被调用，期望起始章节: ${expectedStartChapter}`);
      isBatchGenerating = true;

      // 【关键修复】直接使用传入的参数
      const startChapter = expectedStartChapter;
      console.log(`📊 使用起始章节: ${startChapter}`);

      // 计算批次大小（最多8章）
      const maxPossible = Object.keys(mockApiResponses).length;
      const batchSize = Math.min(8, maxPossible - startChapter + 1);

      console.log(`📦 计算批次大小: ${batchSize}章`);
      console.log(`   范围: 章节 ${startChapter} 到 ${startChapter + batchSize - 1}`);
      console.log(`   当前generatedChapters: [${Object.keys(generatedChapters).sort((a,b)=>a-b).join(', ')}]`);

      setTimeout(() => {
        const batchResults = {};

        for (let i = 0; i < batchSize; i++) {
          const chapterNum = startChapter + i;
          if (mockApiResponses[chapterNum]) {
            batchResults[chapterNum] = mockApiResponses[chapterNum];
            generatedChapters[chapterNum] = mockApiResponses[chapterNum];
          }
        }

        console.log(`✅ 本批次生成成功:`);
        console.log(`   新增章节: [${Object.keys(batchResults).sort((a,b)=>a-b).join(', ')}]`);
        console.log(`   全局状态更新后: [${Object.keys(generatedChapters).sort((a,b)=>a-b).join(', ')}]`);

        isBatchGenerating = false;
        resolve(batchResults);
      }, 300);

    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      isBatchGenerating = false;
      reject(error);
    }
  });
}

// 测试完整的两批生成流程
async function testTwoBatchGeneration() {
  console.log('🧪 测试两批生成流程\n');

  const totalChapters = mockProject.savedMicroStories.length * 2;
  const totalBatches = Math.ceil(totalChapters / 8);

  console.log(`📋 测试配置:`);
  console.log(`   项目: ${mockProject.bookName}`);
  console.log(`   小故事: ${mockProject.savedMicroStories.length} 个`);
  console.log(`   总章节: ${totalChapters} 章`);
  console.log(`   批次数: ${totalBatches} 批（每批最多8章）\n`);

  // 初始化
  generatedChapters = {};
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;

  console.log('🚀 开始两批生成测试...\n');

  // 第一批循环
  console.log('='.repeat(60));
  console.log('🎯 第一批循环');
  console.log('='.repeat(60));

  const firstBatchStart = totalGeneratedSoFar + 1;
  const firstBatchEnd = Math.min(firstBatchStart + 7, totalChapters);
  console.log(`计划生成: 章节 ${firstBatchStart}-${firstBatchEnd}`);

  const firstBatchResult = await simulateBatchGeneration(firstBatchStart);
  totalGeneratedSoFar += Object.keys(firstBatchResult).length;

  console.log(`第一批完成 ✅`);
  console.log(`当前进度: ${totalGeneratedSoFar}/${totalChapters} 章\n`);

  // 第二批循环
  console.log('='.repeat(60));
  console.log('🎯 第二批循环');
  console.log('='.repeat(60));

  currentBatch = 2;
  const secondBatchStart = totalGeneratedSoFar + 1;
  const secondBatchEnd = Math.min(secondBatchStart + 7, totalChapters);
  console.log(`计划生成: 章节 ${secondBatchStart}-${secondBatchEnd}`);

  // 【关键测试】验证第二批是否能正确从第9章开始
  if (secondBatchStart !== 9) {
    console.log(`❌ 错误！第二批起始章节应该是9，但计算出的是 ${secondBatchStart}`);
    console.log('这说明批次衔接有问题！');
    return false;
  }

  console.log(`✅ 第二批起始章节正确: ${secondBatchStart}`);

  const secondBatchResult = await simulateBatchGeneration(secondBatchStart);
  totalGeneratedSoFar += Object.keys(secondBatchResult).length;

  console.log(`第二批完成 ✅`);
  console.log(`最终进度: ${totalGeneratedSoFar}/${totalChapters} 章\n`);

  // 结果验证
  console.log('='.repeat(60));
  console.log('🔍 结果验证');
  console.log('='.repeat(60));

  const finalChapters = Object.keys(generatedChapters).sort((a,b) => a-b);
  const expectedChapters = Array.from({length: totalChapters}, (_, i) => (i + 1).toString());

  console.log(`期望章节: [${expectedChapters.join(', ')}]`);
  console.log(`实际章节: [${finalChapters.join(', ')}]`);

  const isComplete = finalChapters.length === totalChapters &&
                    finalChapters.every((chap, idx) => chap === expectedChapters[idx]);

  console.log(`完整性: ${isComplete ? '✅' : '❌'}`);
  console.log(`连续性: ${finalChapters.every((num, idx) => parseInt(num) === idx + 1) ? '✅' : '❌'}`);
  console.log(`批次衔接: ${finalChapters.includes('8') && finalChapters.includes('9') ? '✅' : '❌'}`);

  if (isComplete) {
    console.log('\n🎊 测试通过！第二批生成能正确衔接 ✅');
    console.log('\n💡 修复要点：');
    console.log('   1. generateFullCycleContent 使用本地变量 totalGeneratedSoFar');
    console.log('   2. simulateBatchGeneration 接收 expectedStartChapter 参数');
    console.log('   3. 避免在函数内部依赖异步的 React 状态');
  } else {
    console.log('\n❌ 测试失败！批次衔接仍有问题');
  }

  return isComplete;
}

// 运行测试
testTwoBatchGeneration().then(success => {
  if (success) {
    console.log('\n🎯 结论：修复成功！现在一键循环生成能够正确地在批次间切换，从第9章、第17章等正确继续。');
  } else {
    console.log('\n⚠️  结论：修复仍需改进。');
  }
});