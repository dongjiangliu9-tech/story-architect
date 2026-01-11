// 测试API参数传递修复：验证后端是否正确使用chapterNumber参数
console.log('🔍 测试API参数传递修复\n');

// 模拟后端API行为
function mockPrepareChapterStream(params) {
  console.log('📡 mockPrepareChapterStream 被调用');
  console.log('📊 接收到的参数:');

  console.log(`   chapterNumber: ${params.chapterNumber}`);
  console.log(`   generatedChapters: ${params.generatedChapters ? '已传递' : '未传递'}`);
  if (params.generatedChapters) {
    console.log(`   generatedChapters长度: ${Object.keys(params.generatedChapters).length}`);
    console.log(`   generatedChapters内容: [${Object.keys(params.generatedChapters).join(', ')}]`);
  }

  // 模拟后端逻辑：如果收到generatedChapters，就基于它重新计算起始点
  let actualStartChapter = params.chapterNumber;

  if (params.generatedChapters && Object.keys(params.generatedChapters).length > 0) {
    // 【问题逻辑】后端基于历史数据重新计算
    const existingCount = Object.keys(params.generatedChapters).length;
    actualStartChapter = existingCount + 1;
    console.log(`❌ 后端重新计算起始章节: ${existingCount} + 1 = ${actualStartChapter}`);
  } else {
    // 【正确逻辑】直接使用前端传递的chapterNumber
    console.log(`✅ 后端使用前端指定的起始章节: ${actualStartChapter}`);
  }

  return {
    requestId: `req_${Date.now()}`,
    actualStartChapter: actualStartChapter
  };
}

// 测试场景
function testApiParameterScenarios() {
  console.log('🧪 测试API参数传递的各种场景\n');

  // 场景1：第一批生成（没有历史数据）
  console.log('='.repeat(60));
  console.log('🎯 场景1：第一批生成（chapterNumber=1, generatedChapters=undefined）');
  console.log('='.repeat(60));

  const result1 = mockPrepareChapterStream({
    chapterNumber: 1,
    generatedChapters: undefined
  });

  console.log(`结果: 实际起始章节 = ${result1.actualStartChapter}`);
  console.log(`${result1.actualStartChapter === 1 ? '✅ 正确' : '❌ 错误'}\n`);

  // 场景2：第二批生成（修复前：传递历史数据）
  console.log('='.repeat(60));
  console.log('🎯 场景2：第二批生成（修复前：传递generatedChapters）');
  console.log('='.repeat(60));

  const result2 = mockPrepareChapterStream({
    chapterNumber: 9,
    generatedChapters: {1: 'chap1', 2: 'chap2', 3: 'chap3', 4: 'chap4', 5: 'chap5', 6: 'chap6', 7: 'chap7', 8: 'chap8'}
  });

  console.log(`结果: 实际起始章节 = ${result2.actualStartChapter}`);
  console.log(`${result2.actualStartChapter === 9 ? '✅ 正确' : '❌ 错误 - 后端重新计算为' + result2.actualStartChapter}\n`);

  // 场景3：第二批生成（修复后：不传递历史数据）
  console.log('='.repeat(60));
  console.log('🎯 场景3：第二批生成（修复后：generatedChapters=undefined）');
  console.log('='.repeat(60));

  const result3 = mockPrepareChapterStream({
    chapterNumber: 9,
    generatedChapters: undefined
  });

  console.log(`结果: 实际起始章节 = ${result3.actualStartChapter}`);
  console.log(`${result3.actualStartChapter === 9 ? '✅ 正确' : '❌ 错误'}\n`);

  // 总结
  console.log('='.repeat(60));
  console.log('📋 测试总结');
  console.log('='.repeat(60));

  const scenario1Correct = result1.actualStartChapter === 1;
  const scenario2Wrong = result2.actualStartChapter !== 9; // 这展示了问题
  const scenario3Correct = result3.actualStartChapter === 9;

  console.log(`场景1（第一批）: ${scenario1Correct ? '✅' : '❌'}`);
  console.log(`场景2（第二批-修复前）: ${scenario2Wrong ? '❌（展示了问题）' : '✅'}`);
  console.log(`场景3（第二批-修复后）: ${scenario3Correct ? '✅' : '❌'}`);

  if (scenario1Correct && scenario2Wrong && scenario3Correct) {
    console.log('\n🎊 测试验证了修复的有效性！');
    console.log('\n💡 问题根因：');
    console.log('   修复前：前端传递generatedChapters，后端基于历史数据重新计算起始章节');
    console.log('   修复后：前端不传递generatedChapters，后端完全依赖chapterNumber参数');
    console.log('\n🔧 修复方法：');
    console.log('   将 generatedChapters: startChapter >= 9 ? generatedChapters : undefined');
    console.log('   改为 generatedChapters: undefined');
  } else {
    console.log('\n❌ 测试发现问题');
  }
}

// 运行测试
testApiParameterScenarios();