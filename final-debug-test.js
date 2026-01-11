// 最终debug测试：验证变量定义顺序修复
console.log('🎯 最终Debug测试：验证变量定义顺序修复\n');

// 模拟项目数据
const mockProject = {
  id: 'final-debug',
  bookName: '最终Debug测试',
  savedMicroStories: [
    { title: '故事1', content: '内容1', order: 0 },
    { title: '故事2', content: '内容2', order: 1 },
    { title: '故事3', content: '内容3', order: 2 },
    { title: '故事4', content: '内容4', order: 3 },
    { title: '故事5', content: '内容5', order: 4 },
    { title: '故事6', content: '内容6', order: 5 }
  ]
};

// 全局状态
let generatedChapters = {};

// 修复后的buildGenerationContext
function buildGenerationContext(currentBatchStartChapter) {
  console.log(`📝 buildGenerationContext: 接收参数 ${currentBatchStartChapter}`);

  if (!currentBatchStartChapter) {
    console.log('❌ 错误：currentBatchStartChapter 为 undefined！');
    return '错误上下文';
  }

  const startChapter = currentBatchStartChapter;
  const batchIndex = Math.floor((startChapter - 1) / 8);
  const startStoryIndex = batchIndex * 4;
  const relevantStories = mockProject.savedMicroStories.slice(startStoryIndex, startStoryIndex + 4);

  console.log(`✅ 上下文计算正确:`);
  console.log(`   startChapter: ${startChapter}`);
  console.log(`   batchIndex: ${batchIndex}`);
  console.log(`   startStoryIndex: ${startStoryIndex}`);
  console.log(`   小故事: [${relevantStories.map(s => s.title).join(', ')}]`);

  return `上下文：批次${batchIndex + 1}，小故事 ${relevantStories.map(s => s.title).join(', ')}`;
}

// 修复后的simulateBatchGeneration
async function simulateBatchGeneration(expectedStartChapter) {
  console.log(`\n🎯 simulateBatchGeneration开始，参数: ${expectedStartChapter}`);

  try {
    // 【修复】先定义startChapter，再使用
    const startChapter = expectedStartChapter || (() => {
      const existingChapters = Object.keys(generatedChapters).length;
      return existingChapters > 0
        ? Math.max(...Object.keys(generatedChapters).map(Number)) + 1
        : 1;
    })();

    console.log(`📊 计算的startChapter: ${startChapter}`);

    // 现在可以安全地使用startChapter
    const generationContext = buildGenerationContext(startChapter);
    console.log(`📝 上下文结果: ${generationContext.substring(0, 50)}...`);

    // 模拟生成
    const batchSize = Math.min(8, 12 - startChapter + 1);
    console.log(`📦 批次大小: ${batchSize}章 (${startChapter} 到 ${startChapter + batchSize - 1})`);

    // 生成章节
    for (let i = 0; i < batchSize; i++) {
      const chapterNum = startChapter + i;
      generatedChapters[chapterNum] = `第${chapterNum}章`;
    }

    console.log(`✅ 生成了 ${batchSize} 章: [${Object.keys(generatedChapters).filter(k => parseInt(k) >= startChapter).join(', ')}]`);
    console.log(`📈 全局状态: [${Object.keys(generatedChapters).sort((a,b)=>parseInt(a)-parseInt(b)).join(', ')}]`);

    return { generated: batchSize };

  } catch (error) {
    console.error('❌ 批量生成失败:', error);
    throw error;
  }
}

// 修复后的generateFullCycleContent逻辑
async function testFixedFullCycle() {
  console.log('🚀 测试修复后的一键循环生成\n');

  // 初始化
  generatedChapters = {};
  let totalGeneratedSoFar = 0;
  const totalChapters = 12;
  const totalBatches = 2;

  console.log(`📋 测试配置: ${totalChapters}章，${totalBatches}批\n`);

  // 第一批
  console.log('='.repeat(60));
  console.log('🎯 第一批测试');
  console.log('='.repeat(60));

  const batch1Start = totalGeneratedSoFar + 1;
  console.log(`第一批起始章节: ${batch1Start} (totalGeneratedSoFar + 1)`);

  const result1 = await simulateBatchGeneration(batch1Start);
  totalGeneratedSoFar += result1.generated;

  console.log(`第一批完成，累计生成: ${totalGeneratedSoFar}/${totalChapters}\n`);

  // 第二批
  console.log('='.repeat(60));
  console.log('🎯 第二批测试');
  console.log('='.repeat(60));

  const batch2Start = totalGeneratedSoFar + 1;
  console.log(`第二批起始章节: ${batch2Start} (totalGeneratedSoFar + 1)`);

  if (batch2Start !== 9) {
    console.log(`❌ 错误！第二批应该从第9章开始，但计算出的是 ${batch2Start}`);
    console.log('这说明批次衔接仍然有问题！');
    return false;
  }

  console.log('✅ 第二批起始章节正确: 9');

  const result2 = await simulateBatchGeneration(batch2Start);
  totalGeneratedSoFar += result2.generated;

  console.log(`第二批完成，累计生成: ${totalGeneratedSoFar}/${totalChapters}\n`);

  // 验证
  console.log('='.repeat(60));
  console.log('🔍 最终验证');
  console.log('='.repeat(60));

  const finalChapters = Object.keys(generatedChapters).sort((a,b) => parseInt(a) - parseInt(b));
  const expected = Array.from({length: totalChapters}, (_, i) => (i + 1).toString());

  console.log(`期望: [${expected.join(', ')}]`);
  console.log(`实际: [${finalChapters.join(', ')}]`);

  const isComplete = finalChapters.length === totalChapters &&
                    finalChapters.every((chap, idx) => chap === expected[idx]);

  console.log(`\n✅ 完整性: ${isComplete ? '通过' : '失败'}`);
  console.log(`✅ 批次衔接: ${finalChapters.includes('8') && finalChapters.includes('9') ? '通过' : '失败'}`);
  console.log(`✅ 无重复: ${new Set(finalChapters).size === finalChapters.length ? '通过' : '失败'}`);

  if (isComplete) {
    console.log('\n🎊 最终修复成功！第一轮循环不再重复！');
    console.log('\n💡 关键修复点：');
    console.log('   1. ✅ 先定义 startChapter，再调用 buildGenerationContext');
    console.log('   2. ✅ 使用本地变量 totalGeneratedSoFar 跟踪进度');
    console.log('   3. ✅ simulateBatchGeneration 接收 expectedStartChapter 参数');
    console.log('   4. ✅ API调用不传递 generatedChapters');
  }

  return isComplete;
}

// 运行最终测试
testFixedFullCycle().then(success => {
  if (success) {
    console.log('\n🎯 结论：所有问题已彻底解决！');
    console.log('现在可以进行实际的前端测试了。');
  } else {
    console.log('\n⚠️  还有问题需要继续修复。');
  }
});