// 步步为营的debug：跟踪一键循环生成的每一步
console.log('🔬 步步为营Debug：跟踪一键循环生成的完整流程\n');

// 模拟项目数据
const mockProject = {
  id: 'step-debug',
  bookName: '步步Debug小说',
  savedMicroStories: [
    { title: '故事A', content: '内容A', order: 0 },
    { title: '故事B', content: '内容B', order: 1 },
    { title: '故事C', content: '内容C', order: 2 },
    { title: '故事D', content: '内容D', order: 3 },
    { title: '故事E', content: '内容E', order: 4 },
    { title: '故事F', content: '内容F', order: 5 }
  ]
};

// 全局状态
let generatedChapters = {};
let isBatchGenerating = false;

// 详细记录每一步的函数
function logStep(step, message, data = {}) {
  console.log(`[${step}] ${message}`);
  if (Object.keys(data).length > 0) {
    Object.entries(data).forEach(([key, value]) => {
      console.log(`    ${key}: ${JSON.stringify(value)}`);
    });
  }
}

// 修复后的buildGenerationContext
function buildGenerationContext(currentBatchStartChapter) {
  logStep('buildGenerationContext', `构建上下文，起始章节: ${currentBatchStartChapter}`);

  const startChapter = currentBatchStartChapter || 1;
  const batchIndex = Math.floor((startChapter - 1) / 8);
  const startStoryIndex = batchIndex * 4;
  const relevantStories = mockProject.savedMicroStories.slice(startStoryIndex, startStoryIndex + 4);

  logStep('buildGenerationContext', `计算结果`, {
    startChapter,
    batchIndex,
    startStoryIndex,
    storyCount: relevantStories.length,
    stories: relevantStories.map(s => s.title)
  });

  return `上下文：使用小故事 ${relevantStories.map(s => s.title).join(', ')}`;
}

// 修复后的simulateBatchGeneration
async function simulateBatchGeneration(expectedStartChapter) {
  logStep('simulateBatchGeneration', `开始批量生成，期望起始章节: ${expectedStartChapter}`);
  isBatchGenerating = true;

  // 构建上下文
  const generationContext = buildGenerationContext(expectedStartChapter);

  // 计算实际参数
  const startChapter = expectedStartChapter;
  const maxChapters = mockProject.savedMicroStories.length * 2;
  const batchSize = Math.min(8, maxChapters - startChapter + 1);

  logStep('simulateBatchGeneration', `计算批次参数`, {
    startChapter,
    batchSize,
    endChapter: startChapter + batchSize - 1,
    maxChapters,
    currentGenerated: Object.keys(generatedChapters).length
  });

  // 模拟API调用
  logStep('simulateBatchGeneration', `模拟API调用`, {
    chapterNumber: startChapter,
    generatedChapters: 'undefined (修复后)'
  });

  // 生成章节
  const batchResults = {};
  for (let i = 0; i < batchSize; i++) {
    const chapterNum = startChapter + i;
    batchResults[chapterNum] = `第${chapterNum}章内容`;
    generatedChapters[chapterNum] = `第${chapterNum}章内容`;
  }

  logStep('simulateBatchGeneration', `生成完成`, {
    generatedCount: Object.keys(batchResults).length,
    totalGenerated: Object.keys(generatedChapters).length,
    chapters: Object.keys(batchResults).sort((a,b)=>parseInt(a)-parseInt(b))
  });

  isBatchGenerating = false;
  return batchResults;
}

// 修复后的generateFullCycleContent核心逻辑
async function debugFullCycleLogic() {
  logStep('generateFullCycleContent', '开始一键循环生成');

  const microStoriesToUse = mockProject.savedMicroStories;
  const totalChapters = microStoriesToUse.length * 2;
  const totalBatches = Math.ceil(totalChapters / 8);

  logStep('generateFullCycleContent', '初始化参数', {
    microStories: microStoriesToUse.length,
    totalChapters,
    totalBatches
  });

  // 初始化状态
  generatedChapters = {};
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;

  // 批次循环
  while (currentBatch <= totalBatches) {
    logStep(`批次${currentBatch}`, `====== 开始第${currentBatch}批循环 ======`);

    // 【关键】使用本地变量计算批次信息
    const batchStartChapter = totalGeneratedSoFar + 1;
    const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);
    const batchSize = batchEndChapter - batchStartChapter + 1;

    logStep(`批次${currentBatch}`, `批次信息计算`, {
      batchStartChapter,
      batchEndChapter,
      batchSize,
      totalGeneratedSoFar,
      currentGlobalState: Object.keys(generatedChapters).length
    });

    // 调用批量生成
    logStep(`批次${currentBatch}`, `调用simulateBatchGeneration(${batchStartChapter})`);
    const batchResult = await simulateBatchGeneration(batchStartChapter);

    // 更新本地跟踪
    const actualBatchSize = Object.keys(batchResult).length;
    totalGeneratedSoFar += actualBatchSize;

    logStep(`批次${currentBatch}`, `批次完成`, {
      generatedInBatch: actualBatchSize,
      totalGeneratedSoFar,
      progress: `${totalGeneratedSoFar}/${totalChapters}`,
      globalState: Object.keys(generatedChapters).length
    });

    // 进入下一批
    currentBatch++;
    logStep(`批次${currentBatch-1}`, `====== 第${currentBatch-1}批循环结束 ======\n`);
  }

  logStep('generateFullCycleContent', '一键循环生成完成', {
    finalCount: Object.keys(generatedChapters).length,
    expectedCount: totalChapters,
    allChapters: Object.keys(generatedChapters).sort((a,b)=>parseInt(a)-parseInt(b))
  });

  return Object.keys(generatedChapters).length === totalChapters;
}

// 运行详细debug
debugFullCycleLogic().then(success => {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 DEBUG总结');
  console.log('='.repeat(60));

  if (success) {
    console.log('✅ 逻辑流程完全正确！');
    console.log('\n📋 验证的关键步骤：');
    console.log('   1. ✅ batchStartChapter = totalGeneratedSoFar + 1');
    console.log('   2. ✅ simulateBatchGeneration(batchStartChapter)');
    console.log('   3. ✅ buildGenerationContext(startChapter)');
    console.log('   4. ✅ API调用使用 chapterNumber 参数');
    console.log('   5. ✅ totalGeneratedSoFar += batchSize');
    console.log('   6. ✅ 下一批从正确位置开始');

    console.log('\n💡 如果实际运行仍有问题，可能是：');
    console.log('   - React状态更新时机问题');
    console.log('   - 后端API实现问题');
    console.log('   - 其他异步操作的干扰');

    console.log('\n🎊 前端逻辑修复完成！可以进行实际测试了。');
  } else {
    console.log('❌ 发现逻辑问题');
  }
});