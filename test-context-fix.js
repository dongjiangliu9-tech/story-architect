// 测试上下文构建修复：验证小故事批次计算是否正确
console.log('🔍 测试上下文构建修复\n');

// 模拟项目数据 - 8个小故事
const mockProject = {
  bookName: '上下文修复测试',
  savedMicroStories: [
    { title: '觉醒', content: '主角觉醒...', order: 0 },
    { title: '入门', content: '入门宗门...', order: 1 },
    { title: '试炼', content: '通过试炼...', order: 2 },
    { title: '历练', content: '外出历练...', order: 3 },
    { title: '秘境', content: '进入秘境...', order: 4 },
    { title: '危机', content: '宗门危机...', order: 5 },
    { title: '突破', content: '境界突破...', order: 6 },
    { title: '决战', content: '最终决战...', order: 7 }
  ]
};

// 模拟React状态
let generatedChapters = {};

// 修复后的buildGenerationContext函数
function buildGenerationContext(currentBatchStartChapter) {
  let context = `=== ${mockProject.bookName} - 完整故事架构背景 ===\n\n`;

  // 当前相关的4个小故事细纲 - 只包含即将生成的内容相关信息
  if (mockProject.savedMicroStories && mockProject.savedMicroStories.length > 0) {
    // 【关键修复】使用传入的参数而不是依赖异步状态
    const startChapter = currentBatchStartChapter || 1;
    const batchIndex = Math.floor((startChapter - 1) / 8); // 计算批次索引（0, 1, 2...）
    const startStoryIndex = batchIndex * 4; // 每批4个小故事（对应8章）
    const relevantStories = mockProject.savedMicroStories.slice(startStoryIndex, startStoryIndex + 4);

    console.log(`📊 上下文计算:`);
    console.log(`   起始章节: ${startChapter}`);
    console.log(`   计算批次索引: ${batchIndex} (Math.floor((${startChapter}-1)/8))`);
    console.log(`   小故事起始索引: ${startStoryIndex} (${batchIndex}*4)`);
    console.log(`   选取小故事: ${startStoryIndex} 到 ${startStoryIndex + 3}`);

    if (relevantStories.length > 0) {
      context += '【本批次小故事细纲】\n';
      relevantStories.forEach((story, index) => {
        const globalIndex = startStoryIndex + index;
        const chapterOffset = globalIndex * 2;
        context += `小故事${globalIndex + 1}（第${chapterOffset + 1}-${chapterOffset + 2}章）：\n`;
        context += `标题：${story.title}\n`;
        context += `内容：${story.content}\n\n`;
      });
    }
  }

  return context;
}

// 测试不同批次的上下文构建
function testContextBuilding() {
  console.log('🧪 测试不同批次的上下文构建\n');

  // 测试第一批（第1-8章）
  console.log('='.repeat(60));
  console.log('🎯 第一批：第1-8章');
  console.log('='.repeat(60));
  const context1 = buildGenerationContext(1);
  console.log('第一批上下文预览:');
  console.log(context1.substring(context1.indexOf('【本批次小故事细纲】'), context1.indexOf('【本批次小故事细纲】') + 200) + '...');
  console.log('');

  // 模拟第一批完成后
  generatedChapters = {1: 'chap1', 2: 'chap2', 3: 'chap3', 4: 'chap4', 5: 'chap5', 6: 'chap6', 7: 'chap7', 8: 'chap8'};
  console.log(`第一批完成后，generatedChapters: [${Object.keys(generatedChapters).join(', ')}]`);
  console.log('');

  // 测试第二批（第9-16章）
  console.log('='.repeat(60));
  console.log('🎯 第二批：第9-16章');
  console.log('='.repeat(60));
  const context2 = buildGenerationContext(9);
  console.log('第二批上下文预览:');
  console.log(context2.substring(context2.indexOf('【本批次小故事细纲】'), context2.indexOf('【本批次小故事细纲】') + 200) + '...');
  console.log('');

  // 验证结果
  console.log('='.repeat(60));
  console.log('🔍 验证结果');
  console.log('='.repeat(60));

  const context1HasFirstBatch = context1.includes('觉醒') && context1.includes('入门') && context1.includes('试炼') && context1.includes('历练');
  const context1MissingSecondBatch = !context1.includes('秘境') && !context1.includes('危机') && !context1.includes('突破') && !context1.includes('决战');

  const context2HasSecondBatch = context2.includes('秘境') && context2.includes('危机') && context2.includes('突破') && context2.includes('决战');
  const context2MissingFirstBatch = !context2.includes('觉醒') && !context2.includes('入门') && !context2.includes('试炼') && !context2.includes('历练');

  console.log(`第一批包含正确的小故事: ${context1HasFirstBatch ? '✅' : '❌'}`);
  console.log(`第一批不包含第二批的小故事: ${context1MissingSecondBatch ? '✅' : '❌'}`);
  console.log(`第二批包含正确的小故事: ${context2HasSecondBatch ? '✅' : '❌'}`);
  console.log(`第二批不包含第一批的小故事: ${context2MissingFirstBatch ? '✅' : '❌'}`);

  const allCorrect = context1HasFirstBatch && context1MissingSecondBatch &&
                    context2HasSecondBatch && context2MissingFirstBatch;

  console.log(`\n${allCorrect ? '🎊 测试通过！上下文构建修复成功 ✅' : '❌ 测试失败！还有问题'}`);

  if (allCorrect) {
    console.log('\n💡 修复要点：');
    console.log('   1. buildGenerationContext 接收 currentBatchStartChapter 参数');
    console.log('   2. 使用参数而非全局状态计算批次索引');
    console.log('   3. 确保每批次使用正确的小故事子集');
  }

  return allCorrect;
}

// 运行测试
testContextBuilding();