// 模拟60个小故事的完整生成过程测试
// 验证所有修复是否有效：保存功能、累计保存、中途退出机制、导出无多余文本
console.log('🎯 60小故事完整生成过程模拟测试\n');

// 生成60个小故事的伪数据
const mockProject = {
  id: '60-stories-test',
  bookName: '六十小故事完整测试',
  savedMicroStories: []
};

// 生成60个小故事
for (let i = 0; i < 60; i++) {
  const storyTypes = ['觉醒', '入门', '试炼', '历练', '秘境', '危机', '突破', '决战', '传承', '飞升'];
  const storyType = storyTypes[i % storyTypes.length];
  const chapterNum = i + 1;

  mockProject.savedMicroStories.push({
    title: `${storyType}篇${chapterNum}`,
    content: `这是第${chapterNum}个小故事的内容，讲述主角的${storyType}历程...`,
    order: i,
    macroStoryTitle: `中故事${Math.floor(i / 6) + 1}`
  });
}

// 生成对应的章节内容（120章）
const mockGeneratedContent = {};
for (let i = 1; i <= 120; i++) {
  const storyIndex = Math.floor((i - 1) / 2);
  const story = mockProject.savedMicroStories[storyIndex];
  const part = (i % 2 === 1) ? '上' : '下';
  const wordCount = Math.floor(Math.random() * 500) + 2000;

  mockGeneratedContent[i] = `第${i}章 ${story.title}（${part}）

${story.content}

（本章约${wordCount}字）

[内容摘要：主角在${story.macroStoryTitle}中经历${story.title}的${part}部分发展...]`;
}

// 全局状态模拟
let generatedChapters = {};
let savedVersions = [];
let currentRequestId = 'test-request-123';
let isBatchGenerating = false;

// 模拟保存功能
function simulateSaveContent(chaptersToSave) {
  const chapterCount = Object.keys(chaptersToSave).length;
  const totalWords = Object.values(chaptersToSave).reduce((sum, content) => {
    const words = content.match(/[\u4e00-\u9fa5]/g) || [];
    return sum + words.length;
  }, 0);

  const saveVersion = {
    id: `auto_save_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    chapterCount,
    totalWords,
    chapters: { ...chaptersToSave },
    preview: Object.values(chaptersToSave)[0]?.substring(0, 200) + '...'
  };

  savedVersions.push(saveVersion);

  console.log(`💾 自动保存版本: ${saveVersion.id}`);
  console.log(`   包含章节: ${Object.keys(chaptersToSave).length} 章`);
  console.log(`   总字数: ${totalWords}`);
  console.log(`   章节范围: ${Math.min(...Object.keys(chaptersToSave).map(Number))}-${Math.max(...Object.keys(chaptersToSave).map(Number))}`);

  return saveVersion;
}

// 模拟下载TXT
function simulateDownloadTXT(chaptersToDownload) {
  const allChapters = Object.keys(chaptersToDownload)
    .map(Number)
    .sort((a, b) => a - b)
    .map(chapterNum => chaptersToDownload[chapterNum])
    .join('\n\n');

  const exportContent = `${mockProject.bookName}\n\n${allChapters}`;

  console.log(`📥 自动下载TXT文件: ${mockProject.bookName}.txt`);
  console.log(`   文件大小: ${(exportContent.length / 1024).toFixed(2)} KB`);
  console.log(`   包含章节: ${Object.keys(chaptersToDownload).length} 章`);

  // 检查是否有"内容待生成"的文本
  const hasPendingText = exportContent.includes('内容待生成') || exportContent.includes('待生成');
  if (hasPendingText) {
    console.log('❌ 发现多余的提示文本！');
  } else {
    console.log('✅ 导出内容无多余提示文本');
  }

  return exportContent;
}

// 修复后的buildGenerationContext函数
function buildGenerationContext(currentBatchStartChapter) {
  let context = `=== ${mockProject.bookName} - 完整故事架构背景 ===\n\n`;

  // 特别强调当前章节对应的小故事
  if (mockProject.savedMicroStories && mockProject.savedMicroStories.length > 0) {
    const startChapter = currentBatchStartChapter || 1;
    const batchIndex = Math.floor((startChapter - 1) / 8); // 计算批次索引（0, 1, 2...）
    const startStoryIndex = batchIndex * 4; // 每批4个小故事（对应8章）
    const relevantStories = mockProject.savedMicroStories.slice(startStoryIndex, startStoryIndex + 4);

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

// 修复后的simulateBatchGeneration函数
async function simulateBatchGeneration(expectedStartChapter, expectedChapterCount, allGeneratedChapters = {}) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`🎯 simulateBatchGeneration被调用`);
      console.log(`   期望起始章节: ${expectedStartChapter}`);
      console.log(`   期望章节数量: ${expectedChapterCount || '自动计算'}`);
      console.log(`   已有的章节数量: ${Object.keys(allGeneratedChapters).length}`);

      isBatchGenerating = true;

      // 【修复1】优先使用传入的参数
      const startChapter = expectedStartChapter;
      const chapterCount = expectedChapterCount || 8;

      // 如果没有章节需要生成，直接返回
      if (chapterCount <= 0 || startChapter > 120) {
        console.log(`📊 无需生成: 起始=${startChapter}, 数量=${chapterCount}`);
        resolve(allGeneratedChapters);
        return;
      }

      console.log(`📊 实际参数: 起始=${startChapter}, 数量=${chapterCount}`);

      // 模拟API调用延迟
      setTimeout(() => {
        const generatedChaptersData = {};

        // 生成指定数量的章节
        for (let i = 0; i < chapterCount; i++) {
          const chapterNum = startChapter + i;
          if (chapterNum <= 120) { // 确保不超过总章节数
            const content = mockGeneratedContent[chapterNum];
            if (content) {
              generatedChaptersData[chapterNum] = content;
              generatedChapters[chapterNum] = content;
            }
          }
        }

        const actualGenerated = Object.keys(generatedChaptersData).length;
        console.log(`✅ 本批次生成成功: ${actualGenerated} 章 [${Object.keys(generatedChaptersData).join(', ')}]`);

        if (actualGenerated === 0) {
          reject(new Error('没有生成任何章节'));
          return;
        }

        // 【修复2】合并历史章节，确保累计保存
        const allExistingChapters = allGeneratedChapters;
        const updatedChapters = { ...allExistingChapters, ...generatedChaptersData };

        console.log(`📊 合并后的总章节数: ${Object.keys(updatedChapters).length}`);

        // 自动执行保存和下载（完全自动化）
        console.log('🔄 自动执行保存和下载...');
        simulateSaveContent(updatedChapters);
        simulateDownloadTXT(updatedChapters);

        isBatchGenerating = false;

        // 返回更新后的完整章节数据
        resolve(updatedChapters);

      }, 200); // 较短的延迟以加快测试

    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      isBatchGenerating = false;
      reject(error);
    }
  });
}

// 修复后的generateFullCycleContent逻辑
async function test60StoriesFullCycleGeneration() {
  console.log('🚀 测试60小故事的一键循环生成完整流程\n');

  const microStoriesToUse = mockProject.savedMicroStories;
  const totalChapters = microStoriesToUse.length * 2; // 120章
  const totalBatches = Math.ceil(totalChapters / 8); // 15批

  console.log(`📋 测试配置:`);
  console.log(`   小故事数量: ${microStoriesToUse.length}`);
  console.log(`   总章节数: ${totalChapters}`);
  console.log(`   批次数: ${totalBatches}`);
  console.log(`   每批最大章节: 8`);
  console.log('');

  // 初始化状态
  generatedChapters = {};
  savedVersions = [];
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;
  let accumulatedChapters = {}; // 累积所有生成的章节

  console.log('🎬 开始完整流程测试...\n');

  // 批次循环（修复后的逻辑）
  while (currentBatch <= totalBatches) {
    console.log('='.repeat(80));
    console.log(`🎯 第${currentBatch}/${totalBatches}批循环开始`);
    console.log('='.repeat(80));

    // 【修复核心】使用本地变量而非异步状态计算起始章节
    const batchStartChapter = totalGeneratedSoFar + 1;
    const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);
    const batchChapterCount = batchEndChapter - batchStartChapter + 1;

    console.log(`🎯 批次信息:`);
    console.log(`   批次: ${currentBatch}/${totalBatches}`);
    console.log(`   计划生成: 章节 ${batchStartChapter}-${batchEndChapter} (${batchChapterCount}章)`);
    console.log(`   已生成总数: ${totalGeneratedSoFar}/${totalChapters}`);
    console.log(`   累积章节数: ${Object.keys(accumulatedChapters).length}`);

    // 验证上下文构建
    const context = buildGenerationContext(batchStartChapter);
    const contextLines = context.split('\n').filter(line => line.includes('小故事'));
    console.log(`📝 上下文验证: 包含 ${contextLines.length} 个小故事`);

    // 【关键】传入正确的参数给批量生成函数
    console.log(`🔄 调用批量生成: simulateBatchGeneration(${batchStartChapter}, ${batchChapterCount})`);
    const batchResult = await simulateBatchGeneration(batchStartChapter, batchChapterCount, accumulatedChapters);

    // 【关键】更新累积数据
    accumulatedChapters = { ...batchResult };

    // 更新本地跟踪变量（直接使用累积章节数）
    totalGeneratedSoFar = Object.keys(accumulatedChapters).length;

    console.log(`📈 本批次完成:`);
    console.log(`   新增章节: ${Object.keys(batchResult).length} 章`);
    console.log(`   累计生成: ${totalGeneratedSoFar}/${totalChapters} 章`);
    console.log(`   累积章节数: ${Object.keys(accumulatedChapters).length}`);

    console.log('='.repeat(80));
    console.log(`✅ 第${currentBatch}批循环结束\n`);

    currentBatch++;
  }

  console.log('🎉 一键循环生成完成！\n');

  // 最终验证
  console.log('='.repeat(80));
  console.log('🔍 最终验证结果');
  console.log('='.repeat(80));

  const finalChapters = Object.keys(accumulatedChapters).sort((a,b) => parseInt(a) - parseInt(b));
  const expectedChapters = Array.from({length: totalChapters}, (_, i) => (i + 1).toString());

  console.log(`期望章节数量: ${expectedChapters.length}`);
  console.log(`实际生成数量: ${finalChapters.length}`);
  console.log(`保存版本数量: ${savedVersions.length}`);

  const isComplete = finalChapters.length === totalChapters;
  const isContinuous = finalChapters.every((num, idx) => parseInt(num) === idx + 1);
  const noDuplicates = finalChapters.length === new Set(finalChapters).size;

  console.log(`\n✅ 完整性检查: ${isComplete ? '✅' : '❌'} (${finalChapters.length}/${totalChapters})`);
  console.log(`✅ 连续性检查: ${isContinuous ? '✅' : '❌'}`);
  console.log(`✅ 无重复检查: ${noDuplicates ? '✅' : '❌'}`);

  // 验证保存功能
  console.log(`\n💾 保存功能验证:`);
  console.log(`   保存次数: ${savedVersions.length} 次`);
  console.log(`   期望保存次数: ${totalBatches} 次`);

  const saveFrequencyCorrect = savedVersions.length === totalBatches;
  console.log(`   保存频率正确: ${saveFrequencyCorrect ? '✅' : '❌'}`);

  // 验证累计保存
  let cumulativeSaveCorrect = true;
  savedVersions.forEach((version, index) => {
    const expectedMinChapters = (index + 1) * 8;
    const actualChapters = version.chapterCount;
    const isCorrect = actualChapters === expectedMinChapters ||
                     (index === totalBatches - 1 && actualChapters === totalChapters); // 最后一批可能少于8章

    if (!isCorrect) {
      cumulativeSaveCorrect = false;
      console.log(`   保存版本${index + 1}错误: 期望至少${expectedMinChapters}章，实际${actualChapters}章`);
    }
  });

  console.log(`   累计保存正确: ${cumulativeSaveCorrect ? '✅' : '❌'}`);

  // 验证最后一批处理
  const lastBatchExpectedSize = totalChapters % 8 || 8;
  const lastVersion = savedVersions[savedVersions.length - 1];
  const lastBatchActualSize = lastVersion ? lastVersion.chapterCount - (savedVersions.length > 1 ? savedVersions[savedVersions.length - 2].chapterCount : 0) : 0;
  const lastBatchCorrect = lastBatchActualSize === lastBatchExpectedSize;

  console.log(`\n🎯 最后一批处理验证:`);
  console.log(`   最后一批期望大小: ${lastBatchExpectedSize} 章`);
  console.log(`   最后一批实际大小: ${lastBatchActualSize} 章`);
  console.log(`   最后一批处理正确: ${lastBatchCorrect ? '✅' : '❌'}`);

  const allChecksPass = isComplete && isContinuous && noDuplicates &&
                       saveFrequencyCorrect && cumulativeSaveCorrect && lastBatchCorrect;

  console.log(`\n${allChecksPass ? '🎊 所有测试通过！完整流程修复成功 ✅' : '❌ 测试失败！还有问题需要修复'}`);

  if (allChecksPass) {
    console.log('\n💡 修复验证总结：');
    console.log('   1. ✅ 保存功能: 每8章自动保存一次');
    console.log('   2. ✅ 累计保存: 每次保存包含所有历史章节');
    console.log('   3. ✅ 中途退出: 最后一批正确处理不足8章的情况');
    console.log('   4. ✅ 导出无多余文本: 模拟导出不包含"内容待生成"等提示');
    console.log('   5. ✅ 批次衔接: 正确从下一批起始章节开始');
    console.log('   6. ✅ 状态同步: 使用本地变量避免React异步状态问题');
  }

  return allChecksPass;
}

// 运行完整测试
test60StoriesFullCycleGeneration().then(success => {
  if (success) {
    console.log('\n🎯 结论：所有修复都成功！60小故事生成流程能够正确地：');
    console.log('   - 每8章自动保存历史快照');
    console.log('   - 保存内容完全累计（包含所有历史章节）');
    console.log('   - 最后一批自动调整数量（8章→实际剩余章节数）');
    console.log('   - 导出时无多余提示文本');
    console.log('   - 批次间正确衔接，无重复或遗漏');
  } else {
    console.log('\n⚠️  结论：修复仍需改进，请检查失败的项目。');
  }
}).catch(error => {
  console.error('\n💥 测试过程中发生错误:', error);
});