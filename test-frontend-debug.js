// 前端Debug：模拟完整的React环境和一键循环生成流程
console.log('🔍 前端Debug：模拟一键循环生成流程\n');

// 模拟React状态
let generatedChapters = {};
let isBatchGenerating = false;

// 模拟项目数据 - 4个小故事，对应8章
const mockProject = {
  id: 'debug-frontend',
  bookName: '前端Debug小说',
  savedMicroStories: [
    {
      title: '少年觉醒',
      content: '主角李明在山村中意外发现古墓，获得神秘传承，开启修仙之路。',
      macroStoryTitle: '入门篇',
      order: 0
    },
    {
      title: '宗门考验',
      content: '李明进入青云宗，通过重重考验，最终被收入内门弟子。',
      macroStoryTitle: '入门篇',
      order: 1
    },
    {
      title: '秘境历练',
      content: '宗门组织弟子进入秘境历练，李明在其中获得机缘，实力大增。',
      macroStoryTitle: '成长篇',
      order: 2
    },
    {
      title: '宗门危机',
      content: '魔道入侵，李明临危受命，与同门并肩作战，展现出领导才能。',
      macroStoryTitle: '成长篇',
      order: 3
    }
  ]
};

// 模拟API响应数据 - 预先准备好的章节内容
const mockApiResponses = {
  // 第一批：1-8章（对应4个小故事）
  1: `第1章 少年觉醒（上）

李明出生在青云山脚下的一个小山村，这个村庄世代以打猎和种田为生。村里的生活平静而单调，但李明总觉得自己的命运不应该如此平凡。

这一天，李明像往常一样上山打猎。他追着一只野兔跑进了一个偏僻的山洞，没想到这个山洞竟然通往一个古老的墓葬。

墓葬中布满了灰尘，中央的石棺上刻着古老的符文。好奇心驱使着李明打开了石棺，里面躺着一具保存完好的尸体，手里握着一枚玉简。

当李明触碰到玉简时，一股暖流涌入他的身体，他的脑海中瞬间出现了无数信息。原来这是一枚修仙传承玉简，里面记录了完整的修仙功法！

从这一刻起，李明的命运彻底改变了。他不再是那个普通的山村少年，而是踏上了修仙之路。

（字数：约1850字）`,

  2: `第2章 少年觉醒（下）

获得传承后的李明，迫不及待地想要尝试修炼。但修仙之路远没有他想象的那么简单，入门的第一步就是筑基，需要吸收天地灵气。

青云山虽然灵气充裕，但对于初学者来说仍然十分困难。李明盘坐在山洞中，按照玉简上的功法开始运转周天。

第一次修炼就遇到了困难，灵气入体的感觉让他全身疼痛难忍。但李明咬牙坚持，他知道这是成为强者的必经之路。

经过七天七夜的苦修，李明终于感觉到一丝暖流在丹田凝聚。这就是传说中的筑基成功！

筑基完成后，李明的身体发生了明显的变化：力气变大了，视力更好了，甚至能够感知到周围的灵气波动。

兴奋的李明决定下山返回村庄，但没想到村庄竟然发生了变故...

（字数：约1920字）`,

  3: `第3章 宗门考验（上）

下山的路上，李明遇到了青云宗的巡山弟子。他们发现了李明身上的灵气波动，惊讶地询问他是怎么修炼的。

李明如实相告，没想到却引来了青云宗长老的注意。长老亲自前来考察，发现李明竟然身怀上古传承！

青云宗是大洲上有名的修仙宗门，门内弟子数万，但能够获得上古传承的却寥寥无几。长老决定带李明回宗门，准备对他进行正式的入门考验。

回到青云宗，李明见到了传说中的修仙圣地：仙鹤飞舞，灵药飘香，弟子们御剑飞行，场面蔚为壮观。

入门考验分为三个阶段：心智考验、体质考验、悟性考验。李明需要通过所有考验，才能正式成为青云宗弟子。

心智考验是最简单的，李明凭借着农村生活的磨砺，轻松通过。但接下来的考验将会越来越难...

（字数：约1780字）`,

  4: `第4章 宗门考验（下）

体质考验要求李明在灵力风暴中坚持一个时辰。这场风暴由宗门长老亲自操控，威力巨大。

风暴来临时，李明感觉自己像一片树叶在狂风中飘摇。但他凭借着筑基期的修为和顽强的意志，硬生生坚持了下来。

通过体质考验后，是最后的悟性考验。悟性考验是最难的，需要在一天时间内参悟一门宗门基础功法。

李明坐在悟道台上，手中拿着《青云基础心法》。这门功法玄奥无比，普通人需要一个月才能入门。

但李明拥有上古传承，对天地之道的理解远超常人。只用了三个时辰，他就成功参悟了这门功法！

长老们震惊了，这样的悟性即使在青云宗历史上也是罕见。李明成功通过所有考验，成为青云宗内门弟子。

从这一刻起，李明正式踏上了修仙之路。他的未来，将会如何发展呢？

（字数：约2010字）`,

  5: `第5章 秘境历练（上）

成为内门弟子后，李明开始了正常的宗门生活。每天修炼、学习、参加任务，日子充实而忙碌。

三个月后，宗门组织了一次秘境历练活动。秘境是修仙界的一种特殊空间，里面充满机遇和危险。

李明毫不犹豫地报了名。他知道，只有在实战中才能快速成长。

秘境入口开启的那一刻，李明随着众多弟子进入了其中。秘境内的景象让他目瞪口呆：仙草遍地，灵兽横行，到处都是修炼资源。

但危险也随之而来。秘境中不仅有强大的灵兽，还有其他宗门的弟子。竞争和战斗随时可能发生。

李明小心翼翼地前行，沿途采集了一些灵药。但很快，他就遇到了第一场战斗...

（字数：约1890字）`,

  6: `第6章 秘境历练（下）

战斗的对象是一头筑基期的灵狼。这头灵狼体型巨大，牙齿锋利，实力相当于人类筑基中期修士。

李明深吸一口气，运转《青云基础心法》，一剑刺向灵狼。灵狼灵活地躲开，反过来扑向李明。

战斗十分激烈，李明凭借着上古传承中的战斗技巧，勉强与灵狼周旋。但灵狼的实力毕竟更强，李明渐渐落入下风。

关键时刻，李明想起了传承中的一门秘术：剑气纵横！他猛地催动灵力，一道剑气从剑尖射出，正中灵狼的眼睛。

灵狼痛呼一声，战斗力大减。李明抓住机会，一剑封喉，结束了战斗。

战胜灵狼后，李明获得了灵狼的内丹。这可是好东西，可以用来炼丹或者直接服用。

继续深入秘境，李明又经历了几场战斗，实力稳步提升。但他不知道，更大的危机正在前方等待...

（字数：约1950字）`,

  7: `第7章 宗门危机（上）

秘境历练结束后，李明回到了宗门。他将秘境中的收获上交宗门，得到了长老们的赞赏。

但好景不长，一场突如其来的危机降临了青云宗。魔道宗门突然入侵，声称要夺取青云宗的镇宗之宝。

魔道弟子如潮水般涌来，青云宗的护山大阵摇摇欲坠。宗主下令，所有内门弟子全部出动，抵御外敌。

李明站在城墙上，看着远处黑压压的魔道大军，心中充满了紧张和兴奋。这将是他第一次参加大规模战斗！

战斗打响了。魔道弟子们使用各种阴毒的功法，青云宗弟子则凭借正道功法与之对抗。

李明挥舞着长剑，斩杀了一个又一个魔道弟子。但魔道大军实在太多了，青云宗渐渐落入下风。

就在这时，李明发现了魔道大军的弱点...

（字数：约1820字）`,

  8: `第8章 宗门危机（下）

李明发现魔道大军的弱点在于他们的阵型。魔道弟子们虽然实力强悍，但配合不够默契。

他立刻将这个发现报告给长老，长老们迅速调整战术，利用青云宗的阵法优势，对魔道大军进行分割包围。

战斗进入了白热化。李明带领着一队内门弟子，冲进了魔道大军的侧翼。他使用上古传承中的剑术，杀得魔道弟子血流成河。

在战斗中，李明意外发现了一个魔道长老。这个长老的实力深不可测，是魔道大军的指挥者。

李明知道自己不是对手，但他不能退缩。他鼓起勇气，冲向魔道长老，希望能为宗门争取时间。

战斗的结果出人意料。李明虽然身受重伤，但成功牵制住了魔道长老，为宗门主力争取了宝贵的时间。

最终，青云宗成功击退了魔道大军。李明因为在战斗中的英勇表现，被宗主亲自接见。

从这一刻起，李明成为了青云宗的英雄。他的修仙之路，将会更加精彩！

（字数：约2030字）`
};

// 模拟simulateBatchGeneration函数（修复版本）
async function simulateBatchGeneration(expectedStartChapter) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`🎯 simulateBatchGeneration被调用，期望起始章节: ${expectedStartChapter}`);
      isBatchGenerating = true;

      // 【关键】使用传入的参数而不是依赖异步状态
      const startChapter = expectedStartChapter;
      console.log(`📊 使用起始章节: ${startChapter}`);

      const batchSize = Math.min(8, Object.keys(mockApiResponses).length - startChapter + 1);
      console.log(`📦 本批次大小: ${batchSize}章 (章节 ${startChapter} 到 ${startChapter + batchSize - 1})`);

      // 模拟API调用延迟
      setTimeout(() => {
        const batchResults = {};

        for (let i = 0; i < batchSize; i++) {
          const chapterNum = startChapter + i;
          if (mockApiResponses[chapterNum]) {
            batchResults[chapterNum] = mockApiResponses[chapterNum];
            generatedChapters[chapterNum] = mockApiResponses[chapterNum];
          }
        }

        console.log(`✅ 本批次生成完成:`);
        console.log(`   新生成的章节: [${Object.keys(batchResults).join(', ')}]`);
        console.log(`   全局generatedChapters更新为: [${Object.keys(generatedChapters).join(', ')}]`);

        // 模拟自动保存和下载
        console.log('💾 自动保存内容...');
        console.log('📥 自动下载TXT文件...');

        isBatchGenerating = false;
        resolve(batchResults);
      }, 500);

    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      isBatchGenerating = false;
      reject(error);
    }
  });
}

// 模拟修复后的一键循环生成
async function testFixedFrontendLogic() {
  console.log('🧪 测试修复后的前端一键循环生成逻辑\n');

  console.log(`📖 项目: ${mockProject.bookName}`);
  console.log(`📚 小故事: ${mockProject.savedMicroStories.length} 个`);
  console.log(`📄 总章节: ${mockProject.savedMicroStories.length * 2} 章`);
  console.log(`🔢 批次数: ${Math.ceil((mockProject.savedMicroStories.length * 2) / 8)} 批\n`);

  // 初始化全局状态
  generatedChapters = {};
  isBatchGenerating = false;

  const totalChapters = mockProject.savedMicroStories.length * 2;
  const totalBatches = Math.ceil(totalChapters / 8);

  console.log('🚀 开始一键循环生成...\n');

  // 使用修复后的逻辑
  let totalGeneratedSoFar = 0;
  let currentBatch = 1;

  while (currentBatch <= totalBatches) {
    console.log(`\n🔄 ===== 第${currentBatch}批循环开始 =====`);

    // 【关键修复】使用本地变量计算起始章节
    const batchStartChapter = totalGeneratedSoFar + 1;
    const batchEndChapter = Math.min(batchStartChapter + 7, totalChapters);
    const batchSize = batchEndChapter - batchStartChapter + 1;

    console.log(`🎯 批次信息:`);
    console.log(`   批次: ${currentBatch}/${totalBatches}`);
    console.log(`   计划: 章节 ${batchStartChapter}-${batchEndChapter} (${batchSize}章)`);
    console.log(`   已生成总数: ${totalGeneratedSoFar} 章`);

    // 【关键】传入正确的起始章节参数
    const batchResult = await simulateBatchGeneration(batchStartChapter);

    console.log(`📈 本批次结果: 生成 ${Object.keys(batchResult).length} 章`);

    // 【关键】更新本地跟踪变量
    totalGeneratedSoFar += Object.keys(batchResult).length;

    console.log(`🔄 ===== 第${currentBatch}批循环结束 =====\n`);

    currentBatch++;
  }

  console.log('🎉 一键循环生成完成！\n');

  // 最终验证
  const finalCount = Object.keys(generatedChapters).length;
  console.log(`📊 最终统计:`);
  console.log(`   期望生成: ${totalChapters} 章`);
  console.log(`   实际生成: ${finalCount} 章`);
  console.log(`   生成的章节: [${Object.keys(generatedChapters).sort((a,b)=>a-b).join(', ')}]`);

  const isSuccess = finalCount === totalChapters;
  console.log(`\n${isSuccess ? '🎊 测试成功！修复有效 ✅' : '❌ 测试失败！还有问题'}`);

  return isSuccess;
}

// 运行测试
testFixedFrontendLogic().then(success => {
  if (success) {
    console.log('\n💡 总结：问题的根本原因是 simulateBatchGeneration 函数内部仍然依赖异步的 React 状态来计算起始章节。修复方法是传入明确的起始章节参数。');
  }
});