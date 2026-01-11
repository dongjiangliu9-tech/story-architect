// 检查React状态更新竞态条件问题
console.log('🔍 检查React状态更新竞态条件\n');

// 模拟React组件状态
let reactState = {
  generatedChapters: {},
  currentChapter: 1,
  isFullCycleGenerating: false,
  fullCycleProgress: null
};

// 模拟异步setState (React的实际行为)
function setState(updates) {
  console.log(`📝 setState调用:`, updates);
  // React状态更新是异步的，这里模拟延迟
  setTimeout(() => {
    Object.assign(reactState, updates);
    console.log(`✅ 状态更新完成，当前generatedChapters长度: ${Object.keys(reactState.generatedChapters).length}`);
  }, Math.random() * 50 + 10); // 随机10-60ms延迟
}

// 同步读取状态 (可能读取到旧值)
function getState() {
  return reactState;
}

// 模拟有问题的循环逻辑
async function problematicFullCycleLogic() {
  console.log('❌ 模拟有问题的循环逻辑\n');

  const totalChapters = 12;
  const totalBatches = 2;

  // 问题版本：直接依赖可能过期的状态
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;

  while (currentBatch <= totalBatches) {
    console.log(`\n🔄 第${currentBatch}批开始`);

    // 【问题】这里读取状态，但可能读取到旧值
    const existingCount = Object.keys(getState().generatedChapters).length;
    const batchStartChapter = existingCount + 1;

    console.log(`读取状态: existingCount=${existingCount}, batchStartChapter=${batchStartChapter}`);

    // 模拟生成
    const batchSize = Math.min(8, totalChapters - existingCount);
    console.log(`模拟生成: batchSize=${batchSize}, 章节 ${batchStartChapter}-${batchStartChapter + batchSize - 1}`);

    // 生成过程中多次更新状态 (模拟SSE事件)
    for (let i = 0; i < batchSize; i++) {
      const chapterNum = batchStartChapter + i;
      setState({
        generatedChapters: { ...getState().generatedChapters, [chapterNum]: `第${chapterNum}章` }
      });
    }

    // 等待一会儿，让状态更新完成
    await new Promise(resolve => setTimeout(resolve, 100));

    // 更新本地计数
    totalGeneratedSoFar += batchSize;

    console.log(`第${currentBatch}批结束，totalGeneratedSoFar=${totalGeneratedSoFar}`);

    currentBatch++;
  }

  console.log(`\n❌ 最终结果: ${Object.keys(getState().generatedChapters).length} 章`);
}

// 模拟修复后的循环逻辑
async function fixedFullCycleLogic() {
  console.log('✅ 模拟修复后的循环逻辑\n');

  const totalChapters = 12;
  const totalBatches = 2;

  // 重置状态
  reactState.generatedChapters = {};
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;

  while (currentBatch <= totalBatches) {
    console.log(`\n🔄 第${currentBatch}批开始`);

    // 【修复】使用本地变量，不依赖异步状态
    const batchStartChapter = totalGeneratedSoFar + 1;
    const batchSize = Math.min(8, totalChapters - totalGeneratedSoFar);

    console.log(`使用本地变量: totalGeneratedSoFar=${totalGeneratedSoFar}, batchStartChapter=${batchStartChapter}`);

    // 模拟生成
    console.log(`模拟生成: batchSize=${batchSize}, 章节 ${batchStartChapter}-${batchStartChapter + batchSize - 1}`);

    // 生成过程中更新状态
    for (let i = 0; i < batchSize; i++) {
      const chapterNum = batchStartChapter + i;
      setState({
        generatedChapters: { ...getState().generatedChapters, [chapterNum]: `第${chapterNum}章` }
      });
    }

    // 等待状态更新
    await new Promise(resolve => setTimeout(resolve, 100));

    // 【关键】更新本地变量
    totalGeneratedSoFar += batchSize;

    console.log(`第${currentBatch}批结束，totalGeneratedSoFar=${totalGeneratedSoFar}`);

    currentBatch++;
  }

  console.log(`\n✅ 最终结果: ${Object.keys(getState().generatedChapters).length} 章`);
}

// 测试竞态条件
async function testRaceCondition() {
  console.log('⚡ 测试竞态条件影响\n');

  // 重置状态
  reactState.generatedChapters = {};

  // 快速连续调用setState (模拟实际的SSE事件)
  console.log('快速连续更新状态 (模拟SSE事件流)...');

  for (let i = 1; i <= 8; i++) {
    setState({
      generatedChapters: { ...getState().generatedChapters, [i]: `第${i}章` }
    });
  }

  // 立即读取状态 (可能读取到旧值)
  console.log(`\n立即读取状态: ${Object.keys(getState().generatedChapters).length} 章`);

  // 等待所有更新完成
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log(`等待后读取状态: ${Object.keys(getState().generatedChapters).length} 章`);

  console.log('\n💡 这展示了React异步状态更新的问题！');
}

// 主测试
async function runAllTests() {
  console.log('='.repeat(70));
  console.log('🧪 竞态条件检查');
  console.log('='.repeat(70));
  console.log('');

  await testRaceCondition();
  console.log('\n' + '='.repeat(50) + '\n');

  await problematicFullCycleLogic();
  console.log('\n' + '='.repeat(50) + '\n');

  await fixedFullCycleLogic();

  console.log('\n' + '='.repeat(70));
  console.log('📋 检查结论');
  console.log('='.repeat(70));

  console.log('✅ 已识别的关键问题：');
  console.log('   1. React状态异步更新导致竞态条件');
  console.log('   2. 循环中依赖可能过期的状态值');
  console.log('   3. SSE事件流中的连续状态更新');
  console.log('');
  console.log('✅ 修复方案：');
  console.log('   1. 使用本地变量 totalGeneratedSoFar');
  console.log('   2. 避免在循环中读取异步状态');
  console.log('   3. 主动管理批次间的状态转换');
  console.log('');
  console.log('💡 如果实际运行仍有问题，可能是后端API或更深层的React问题。');
}

// 运行测试
runAllTests();