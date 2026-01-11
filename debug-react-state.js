// Debug React状态异步更新对循环逻辑的影响
console.log('🔍 Debug React状态异步更新问题\n');

// 模拟React状态
let generatedChaptersState = {};
let pendingStateUpdates = [];

// 模拟React的setState (异步更新)
function setGeneratedChapters(newValue) {
  console.log(`📝 setGeneratedChapters调用: ${JSON.stringify(Object.keys(newValue))}`);
  pendingStateUpdates.push(newValue);
}

// 模拟React状态更新完成 (在下一个tick)
function flushStateUpdates() {
  return new Promise(resolve => {
    setTimeout(() => {
      if (pendingStateUpdates.length > 0) {
        generatedChaptersState = pendingStateUpdates[pendingStateUpdates.length - 1];
        pendingStateUpdates = [];
        console.log(`✅ 状态更新完成: ${JSON.stringify(Object.keys(generatedChaptersState))}`);
      }
      resolve();
    }, 10); // 模拟React的异步更新
  });
}

// 获取当前状态 (同步)
function getGeneratedChapters() {
  return generatedChaptersState;
}

// 模拟有问题的版本
async function brokenGenerateFullCycleContent() {
  console.log('❌ 模拟有问题的版本 (直接依赖异步状态)\n');

  const totalChapters = 20;
  const totalBatches = 3;

  generatedChaptersState = {};
  pendingStateUpdates = [];

  for (let currentBatch = 1; currentBatch <= totalBatches; currentBatch++) {
    console.log(`\n🔄 第${currentBatch}批开始`);

    // 【问题】这里直接使用getGeneratedChapters()，但状态可能还没更新
    const existingChapters = Object.keys(getGeneratedChapters()).length;
    const startChapter = existingChapters > 0
      ? Math.max(...Object.keys(getGeneratedChapters()).map(Number)) + 1
      : 1;

    console.log(`   现有章节: [${Object.keys(getGeneratedChapters()).join(', ')}]`);
    console.log(`   计算起始章节: ${startChapter}`);

    // 模拟生成并更新状态
    const newChapters = {};
    const batchSize = Math.min(8, totalChapters - existingChapters);
    for (let i = 0; i < batchSize; i++) {
      const chapterNum = startChapter + i;
      newChapters[chapterNum] = `第${chapterNum}章`;
    }

    setGeneratedChapters({ ...getGeneratedChapters(), ...newChapters });
    console.log(`   新生成: [${Object.keys(newChapters).join(', ')}]`);
    console.log(`   调用setGeneratedChapters后立即读取: [${Object.keys(getGeneratedChapters()).join(', ')}]`);

    // 【这里没有等待状态更新完成】
    console.log(`   第${currentBatch}批结束\n`);
  }

  console.log('❌ 最终结果:', Object.keys(getGeneratedChapters()).length, '章');
}

// 模拟修复后的版本
async function fixedGenerateFullCycleContent() {
  console.log('✅ 模拟修复后的版本 (使用本地变量跟踪)\n');

  const totalChapters = 20;
  const totalBatches = 3;

  generatedChaptersState = {};
  pendingStateUpdates = [];

  // 【关键】使用本地变量跟踪已生成的章节
  let totalGeneratedSoFar = 0;

  for (let currentBatch = 1; currentBatch <= totalBatches; currentBatch++) {
    console.log(`\n🔄 第${currentBatch}批开始`);

    // 【修复】使用本地变量而不是异步状态来计算起始章节
    const startChapter = totalGeneratedSoFar + 1;
    const batchSize = Math.min(8, totalChapters - totalGeneratedSoFar);

    console.log(`   本地跟踪的已生成数: ${totalGeneratedSoFar}`);
    console.log(`   计算起始章节: ${startChapter}`);
    console.log(`   批次大小: ${batchSize}`);

    // 模拟生成
    const newChapters = {};
    for (let i = 0; i < batchSize; i++) {
      const chapterNum = startChapter + i;
      newChapters[chapterNum] = `第${chapterNum}章`;
    }

    setGeneratedChapters({ ...getGeneratedChapters(), ...newChapters });

    // 【关键】立即更新本地跟踪变量
    totalGeneratedSoFar += batchSize;

    console.log(`   新生成: [${Object.keys(newChapters).join(', ')}]`);
    console.log(`   本地跟踪更新为: ${totalGeneratedSoFar}`);

    // 等待React状态更新完成
    await flushStateUpdates();

    console.log(`   第${currentBatch}批结束\n`);
  }

  console.log('✅ 最终结果:', Object.keys(getGeneratedChapters()).length, '章');
}

// 运行测试
async function runTests() {
  await brokenGenerateFullCycleContent();
  console.log('\n' + '='.repeat(50) + '\n');
  await fixedGenerateFullCycleContent();

  console.log('\n🎯 结论：');
  console.log('   问题在于React状态更新的异步性');
  console.log('   在循环中直接依赖异步状态会导致计算错误');
  console.log('   解决方案：使用本地变量跟踪已生成章节数');
}

runTests();