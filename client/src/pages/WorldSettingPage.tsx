// React import not needed with jsx: "react-jsx"
import { useState, useEffect } from 'react';
import { ArrowLeft, Users, BookOpen, Sparkles, Wand2, CheckCircle, FileText, Map, Save, FolderOpen, Trash2, Download, PenTool, X, RefreshCw } from 'lucide-react';
import { blueprintApi } from '../services/api';
import { OutlineData } from '../types';
import { useWorldSettings } from '../contexts/WorldSettingsContext';

/**
 * 将OutlineData格式化为大纲字符串
 */
function formatOutlineData(outline: OutlineData): string {
  return `### ${outline.title}

核心概念：
${outline.logline}

人物关系：
${outline.characters}

世界观设定：
${outline.world}

主要冲突：
${outline.hook}

金手指设定：
${outline.themes}`;
}

/**
 * 清理Markdown格式符号，使内容更美观
 */
function cleanMarkdownFormatting(text: string): string {
  return text
    .replace(/^#+\s*/gm, '') // 移除标题符号
    .replace(/\*\*(.*?)\*\*/g, '$1') // 移除粗体符号
    .replace(/\*(.*?)\*/g, '$1') // 移除斜体符号
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/`(.*?)`/g, '$1') // 移除行内代码
    .replace(/^\s*[-*+]\s+/gm, '') // 移除列表符号
    .replace(/^\s*\d+\.\s+/gm, '') // 移除有序列表符号
    .replace(/^\s*>\s+/gm, '') // 移除引用符号
    .replace(/\n{3,}/g, '\n\n') // 压缩多余的换行
    .trim();
}

interface WorldSettingPageProps {
  onBack: () => void;
  onNavigateToStructure: () => void;
  selectedOutline: OutlineData | null;
  isAutoFlowRunning?: boolean;
  setAutoFlowStep?: (step: string) => void;
  setAutoFlowProgress?: (progress: number) => void;
}

export function WorldSettingPage({ onBack, onNavigateToStructure, selectedOutline, isAutoFlowRunning, setAutoFlowStep, setAutoFlowProgress }: WorldSettingPageProps) {
  const { currentProject, createProject, updateProject, deleteProject, loadProject, exportProject, exportAllProjects, importFromJsonText, projects, clearNovelCacheForProject, clearNovelCacheForAllProjects } = useWorldSettings();
  const [outlineMode, setOutlineMode] = useState<'novel' | 'microdrama'>('novel');
  const [microdramaEpisodeCount, setMicrodramaEpisodeCount] = useState<30 | 60 | 100>(30);
  const [reduceSensitiveContent, setReduceSensitiveContent] = useState(false);
  const [needsUpgradeSystem, setNeedsUpgradeSystem] = useState(true);
  const [useEnglishNames, setUseEnglishNames] = useState(false);

  // 调试：监听项目状态变化
  useEffect(() => {
    console.log('WorldSettingPage - 当前项目状态:', currentProject ? {
      id: currentProject.id,
      name: currentProject.bookName,
      hasWorld: !!currentProject.worldSetting,
      hasChar: !!currentProject.characters,
      hasOutline: !!currentProject.detailedOutline
    } : '无当前项目');
  }, [currentProject]);

  const [worldSetting, setWorldSetting] = useState<string>('');
  const [characters, setCharacters] = useState<string>('');
  const [outline, setOutline] = useState<string>('');
  const [isGeneratingWorldSetting, setIsGeneratingWorldSetting] = useState(false);
  const [isGeneratingCharacters, setIsGeneratingCharacters] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isRegeneratingOutlineWithSuggestion, setIsRegeneratingOutlineWithSuggestion] = useState(false);
  const [outlineRevisionSuggestion, setOutlineRevisionSuggestion] = useState('');
  const [worldSettingGenerated, setWorldSettingGenerated] = useState(false);
  const [charactersGenerated, setCharactersGenerated] = useState(false);
  const [activeTab, setActiveTab] = useState<'world' | 'characters' | 'outline'>('world');

  // 批量生成相关状态
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{current: number, total: number, message: string} | null>(null);

  // 项目管理相关状态
  const [bookName, setBookName] = useState<string>('');
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [editingSection, setEditingSection] = useState<'world' | 'characters' | 'outline' | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<{ world: string; characters: string; outline: string }>({
    world: '',
    characters: '',
    outline: ''
  });
  const [inlineSaveSection, setInlineSaveSection] = useState<'world' | 'characters' | 'outline' | null>(null);
  const [supplementNotes, setSupplementNotes] = useState<{ world: string; characters: string }>({
    world: '',
    characters: ''
  });
  const [isSupplementingWorldSetting, setIsSupplementingWorldSetting] = useState(false);
  const [isSupplementingCharacters, setIsSupplementingCharacters] = useState(false);

  const outlineModeMeta = outlineMode === 'microdrama'
    ? {
        shortName: `微短剧${microdramaEpisodeCount}集`,
        buttonText: `生成微短剧${microdramaEpisodeCount}集大纲`,
        generateHint: microdramaEpisodeCount === 30
          ? '30集约7个中故事：1-2集、3-5集，其余每5集一个卡点'
          : microdramaEpisodeCount === 60
            ? '60集约13个中故事：1-2集、3-5集，其余每5集一个卡点'
            : '100集保留10个中故事卡点，每个卡点拆10集',
        resultTitle: `微短剧${microdramaEpisodeCount}集大纲结果`,
        emptyTitle: `尚未生成微短剧${microdramaEpisodeCount}集大纲`,
        emptyActionText: `手动填写微短剧${microdramaEpisodeCount}集大纲`,
      }
    : {
        shortName: '网文情节细纲',
        buttonText: '生成首批10个中故事',
        generateHint: '网文按约40个中故事规划，每次生成10个；后续可在情节结构细化页继续生成下一批',
        resultTitle: '情节细纲结果',
        emptyTitle: '尚未生成情节细纲',
        emptyActionText: '手动填写情节细纲',
      };

  // 初始化项目名称 - 优先使用selectedOutline的标题
  useEffect(() => {
    if (selectedOutline) {
      // 每次进入人设与世界观界面，都应该使用当前选中的灵感标题作为书名
      setBookName(`${selectedOutline.title}`);
    }
  }, [selectedOutline]);

  // 如果有当前项目，加载其内容
  useEffect(() => {
    if (currentProject) {
      console.log('正在加载项目内容:', currentProject.bookName);
      console.log('项目包含内容 - 世界观:', !!currentProject.worldSetting, '人物:', !!currentProject.characters, '情节:', !!currentProject.detailedOutline);

      // 总是加载当前项目的内容，无论selectedOutline是否匹配
      setBookName(currentProject.bookName);
      setWorldSetting(currentProject.worldSetting || '');
      setCharacters(currentProject.characters || '');
      setOutline(currentProject.detailedOutline || '');
      setWorldSettingGenerated(!!currentProject.worldSetting);
      setCharactersGenerated(!!currentProject.characters);
      setOutlineMode(currentProject.detailedOutlineMode === 'microdrama' ? 'microdrama' : 'novel');
      setMicrodramaEpisodeCount(
        currentProject.microdramaEpisodeCount === 60 || currentProject.microdramaEpisodeCount === 100
          ? currentProject.microdramaEpisodeCount
          : 30
      );
      setReduceSensitiveContent(Boolean(currentProject.reduceSensitiveContent));
      setNeedsUpgradeSystem(currentProject.worldSettingNeedsUpgradeSystem !== false);

      // 如果有内容，自动切换到对应的标签页
      if (currentProject.detailedOutline) {
        setActiveTab('outline');
      } else if (currentProject.characters) {
        setActiveTab('characters');
      } else if (currentProject.worldSetting) {
        setActiveTab('world');
      } else {
        setActiveTab('world');
      }

      console.log('项目内容加载完成');
    } else {
      console.log('没有当前项目，清空内容');
      // 没有当前项目，清空所有内容
      setWorldSetting('');
      setCharacters('');
      setOutline('');
      setWorldSettingGenerated(false);
      setCharactersGenerated(false);
      setActiveTab('world');
      setOutlineMode('novel');
      setNeedsUpgradeSystem(true);

      // 如果有selectedOutline，设置书名
      if (selectedOutline) {
        setBookName(`${selectedOutline.title}`);
      }
    }

    // 切换项目时重置“单块编辑态”，避免编辑草稿串到其它项目
    setEditingSection(null);
  }, [currentProject]);

  // 检查自动化流程
  useEffect(() => {
    const autoFlowFlag = localStorage.getItem('story-architect-auto-flow');
    if (autoFlowFlag === 'world-setting' && selectedOutline && bookName.trim()) {
      console.log('检测到自动化流程：开始自动执行一键生成全部设定');
      localStorage.removeItem('story-architect-auto-flow');

      // 更新自动化状态
      if (setAutoFlowStep) setAutoFlowStep('正在自动点击"一键生成全部设定"...');
      if (setAutoFlowProgress) setAutoFlowProgress(20);

      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        handleBatchGenerate();
      }, 1000);
    }
  }, [selectedOutline, bookName, setAutoFlowStep, setAutoFlowProgress]);

  // 单独处理selectedOutline的变化（当没有当前项目时）
  useEffect(() => {
    if (!currentProject && selectedOutline) {
      setBookName(`${selectedOutline.title}`);
    }
  }, [selectedOutline, currentProject]);

  const handleGenerateWorldSetting = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    setIsGeneratingWorldSetting(true);
    try {
      const outlineData = formatOutlineData(selectedOutline);

      const response = await blueprintApi.generateWorldSetting({
        outline: outlineData,
        needsUpgradeSystem,
      });

      console.log('生成的世界观基础设定:', response.data);
      setWorldSetting(response.data);
      setWorldSettingGenerated(true);
    } catch (error) {
      console.error('生成世界观基础设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '生成世界观基础设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsGeneratingWorldSetting(false);
    }
  };

  const handleGenerateCharacters = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    setIsGeneratingCharacters(true);
    try {
      const outlineData = formatOutlineData(selectedOutline);

      const response = await blueprintApi.generateCharacters({
        outline: outlineData,
        worldSetting: worldSetting,
        useEnglishNames,
      });

      console.log('生成的人物数据:', response.data);
      setCharacters(response.data);
      setCharactersGenerated(true);
    } catch (error) {
      console.error('生成人物失败:', error);
      alert('生成人物失败，请稍后重试');
    } finally {
      setIsGeneratingCharacters(false);
    }
  };

  const handleSupplementWorldSetting = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    const note = supplementNotes.world.trim();
    if (!worldSetting.trim()) {
      alert('请先生成或填写世界观基础设定');
      return;
    }
    if (!note) {
      alert('请先填写要补充的批注');
      return;
    }

    setIsSupplementingWorldSetting(true);
    try {
      const outlineData = formatOutlineData(selectedOutline);
      const response = await blueprintApi.generateWorldSetting({
        outline: outlineData,
        needsUpgradeSystem,
        existingWorldSetting: worldSetting,
        note,
      });

      setWorldSetting(response.data);
      setWorldSettingGenerated(true);
      setSupplementNotes(prev => ({ ...prev, world: '' }));

      if (currentProject) {
        updateProject(currentProject.id, {
          worldSetting: response.data,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
        });
      }

      setInlineSaveSection('world');
      setTimeout(() => setInlineSaveSection(null), 1500);
    } catch (error) {
      console.error('补充世界观基础设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '补充世界观基础设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsSupplementingWorldSetting(false);
    }
  };

  const handleSupplementCharacters = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    const note = supplementNotes.characters.trim();
    if (!characters.trim()) {
      alert('请先生成或填写人物设定');
      return;
    }
    if (!note) {
      alert('请先填写要补充的批注');
      return;
    }

    setIsSupplementingCharacters(true);
    try {
      const outlineData = formatOutlineData(selectedOutline);
      const response = await blueprintApi.generateCharacters({
        outline: outlineData,
        worldSetting,
        useEnglishNames,
        existingCharacters: characters,
        note,
      });

      setCharacters(response.data);
      setCharactersGenerated(true);
      setSupplementNotes(prev => ({ ...prev, characters: '' }));

      if (currentProject) {
        updateProject(currentProject.id, {
          characters: response.data,
        });
      }

      setInlineSaveSection('characters');
      setTimeout(() => setInlineSaveSection(null), 1500);
    } catch (error) {
      console.error('补充人物设定失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '补充人物设定失败，请稍后重试';
      alert(errorMessage);
    } finally {
      setIsSupplementingCharacters(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    setIsGeneratingOutline(true);
    try {
      const outlineData = formatOutlineData(selectedOutline);

      const response = await blueprintApi.generateDetailedOutline({
        outline: outlineData,
        worldSetting: worldSetting,
        characters: characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: '',
      });

      console.log('生成的情节细纲:', response.data);
      setOutline(response.data);
    } catch (error) {
      console.error('生成情节细纲失败:', error);
      alert('生成情节细纲失败，请稍后重试');
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const handleImportOutlineSuggestion = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setOutlineRevisionSuggestion(text.trim());
    } catch (error) {
      console.error('读取情节建议文件失败:', error);
      alert('读取建议文件失败，请改为直接粘贴文本');
    }
  };

  const handleRegenerateOutlineWithSuggestion = async () => {
    if (!selectedOutline && !currentProject?.outline) {
      alert('未找到故事大纲，请返回第一步重新选择或加载项目');
      return;
    }
    if (!worldSetting || !characters || !outline) {
      alert('请先准备好世界观基础设定、人物设定和当前情节细纲');
      return;
    }
    if (!outlineRevisionSuggestion.trim()) {
      alert('请先粘贴或导入修改建议');
      return;
    }

    const confirmed = confirm('将基于当前情节细纲、世界观、人设和导入建议，完整重生成所有中故事。新结果会覆盖当前情节细纲，确定继续吗？');
    if (!confirmed) return;

    setIsRegeneratingOutlineWithSuggestion(true);
    try {
      const outlineData = formatOutlineData(selectedOutline || currentProject!.outline);
      const response = await blueprintApi.generateDetailedOutline({
        outline: outlineData,
        worldSetting,
        characters,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: outline,
        outlineRevisionSuggestion: outlineRevisionSuggestion.trim(),
      });

      setOutline(response.data);
      setActiveTab('outline');

      if (currentProject) {
        updateProject(currentProject.id, {
          detailedOutline: response.data,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
        });
      }

      alert('已根据导入建议重生成情节细纲。');
    } catch (error) {
      console.error('根据建议重生成情节细纲失败:', error);
      alert('根据建议重生成情节细纲失败，请稍后重试');
    } finally {
      setIsRegeneratingOutlineWithSuggestion(false);
    }
  };

  // 保存项目
  const handleSaveProject = () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    if (!bookName.trim()) {
      alert('请输入书名');
      return;
    }

    if (!worldSetting || !characters || !outline) {
      alert('请先生成完整的世界观基础设定、人物设定和情节细纲后再保存');
      return;
    }

    try {
      console.log('开始保存项目，当前项目状态:', currentProject ? '存在' : '不存在');
      console.log('书名:', bookName.trim());
      console.log('世界观基础设定长度:', worldSetting.length);
      console.log('人物设定长度:', characters.length);
      console.log('情节细纲长度:', outline.length);

      if (currentProject) {
        console.log('更新现有项目，项目ID:', currentProject.id);
        // 更新现有项目
        updateProject(currentProject.id, {
          bookName: bookName.trim(),
          worldSetting,
          characters,
          detailedOutline: outline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
        });
      } else {
        console.log('创建新项目');
        // 创建新项目，包含所有生成的内容
        const newProject = createProject(bookName.trim(), selectedOutline, {
          worldSetting,
          characters,
          detailedOutline: outline,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
        });
        console.log('新项目创建完成，项目ID:', newProject.id);
      }

      setShowSaveConfirm(true);
      setTimeout(() => setShowSaveConfirm(false), 2000);
    } catch (error) {
      console.error('保存项目失败:', error);
      alert('保存项目失败，请稍后重试');
    }
  };

  // 加载项目
  const handleLoadProject = (project: any) => {
    loadProject(project);
    setShowProjectPanel(false);
  };

  // 删除项目
  const handleDeleteProject = (projectId: number) => {
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      deleteProject(projectId);
    }
  };

  const handleClearNovelCacheForAll = () => {
    if (projects.length === 0) {
      alert('当前没有任何项目，无需清理。');
      return;
    }
    const confirmed = confirm('确定要清空【所有项目】已生成的小说正文缓存吗？\n\n这会删除：\n- 正文已生成章节\n- 正文版本历史\n- Writer 临时进度\n- auto_gen_* 临时缓存\n\n但会保留：\n- 世界观/人物/情节细纲\n- 小故事/选择的小故事等设定\n\n此操作不可恢复（建议先导出备份）。');
    if (!confirmed) return;
    clearNovelCacheForAllProjects();
    alert('已清空所有项目的正文缓存。');
  };

  const handleClearNovelCacheForOne = (projectId: number, bookName: string) => {
    const confirmed = confirm(`确定要清空《${bookName}》的已生成正文缓存吗？\n\n这会删除：\n- 正文已生成章节\n- 正文版本历史\n- Writer 临时进度\n\n但会保留世界观/人物/大纲/小故事等设定。\n\n此操作不可恢复（建议先导出备份）。`);
    if (!confirmed) return;
    clearNovelCacheForProject(projectId);
    alert(`已清空《${bookName}》的正文缓存。`);
  };

  const handleImportProjectFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = importFromJsonText(text);
      if (result.imported === 0) {
        alert('导入失败：未识别到可用的项目数据（请确认选择的是导出的 JSON 文件）');
        return;
      }
      const skippedMsg = result.skipped > 0 ? `（跳过 ${result.skipped} 条无效数据）` : '';
      alert(`导入成功：已导入 ${result.imported} 个项目${skippedMsg}\n\n提示：已自动加载最新导入的项目，并尽力恢复正文进度。`);
    } catch (error) {
      console.error('导入项目失败:', error);
      alert('导入失败：读取或解析文件出错，请稍后重试');
    }
  };

  // 检查是否可以保存
  const canSave = selectedOutline && bookName.trim() && worldSetting && characters && outline;

  const startEditSection = (section: 'world' | 'characters' | 'outline') => {
    const currentValue =
      section === 'world'
        ? worldSetting
        : section === 'characters'
          ? characters
          : outline;

    setSectionDrafts(prev => ({ ...prev, [section]: currentValue }));
    setEditingSection(section);
  };

  const cancelEditSection = () => {
    setEditingSection(null);
  };

  const saveEditedSection = (section: 'world' | 'characters' | 'outline') => {
    const nextValue = sectionDrafts[section] ?? '';

    if (section === 'world') {
      setWorldSetting(nextValue);
      setWorldSettingGenerated(!!nextValue.trim());
    } else if (section === 'characters') {
      setCharacters(nextValue);
      setCharactersGenerated(!!nextValue.trim());
    } else {
      setOutline(nextValue);
    }

    if (currentProject) {
      updateProject(currentProject.id, {
        ...(section === 'world' ? { worldSetting: nextValue } : {}),
        ...(section === 'characters' ? { characters: nextValue } : {}),
        ...(section === 'outline' ? { detailedOutline: nextValue } : {}),
      });
    }

    setEditingSection(null);
    setInlineSaveSection(section);
    setTimeout(() => setInlineSaveSection(null), 1500);
  };

  // 一键批量生成世界观、人物、情节设定
  const handleBatchGenerate = async () => {
    if (!selectedOutline) {
      alert('未找到选中的故事大纲，请返回第一步重新选择');
      return;
    }

    if (!bookName.trim()) {
      alert('请输入书名');
      return;
    }

    setBatchGenerating(true);
    setBatchGenerationProgress({ current: 1, total: 4, message: '正在生成世界观基础设定...' });
    localStorage.removeItem('story-architect-auto-flow');

    // 更新自动化状态
    if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成世界观基础设定...');
    if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(30);

    try {
      // 第一步：生成世界观基础设定
      const outlineData = formatOutlineData(selectedOutline);
      const worldResponse = await blueprintApi.generateWorldSetting({
        outline: outlineData,
        needsUpgradeSystem,
      });

      console.log('批量生成：世界观基础设定成功');
      setWorldSetting(worldResponse.data);
      setWorldSettingGenerated(true);
      setBatchGenerationProgress({ current: 2, total: 4, message: '正在生成人物设定...' });

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成人物设定...');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(50);

      // 第二步：生成人物设定
      const charactersResponse = await blueprintApi.generateCharacters({
        outline: outlineData,
        worldSetting: worldResponse.data,
        useEnglishNames,
      });

      console.log('批量生成：人物设定成功');
      setCharacters(charactersResponse.data);
      setCharactersGenerated(true);
      setBatchGenerationProgress({ current: 3, total: 4, message: '正在生成情节细纲...' });

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('正在生成情节细纲...');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(70);

      // 第三步：生成情节细纲
      const outlineResponse = await blueprintApi.generateDetailedOutline({
        outline: outlineData,
        worldSetting: worldResponse.data,
        characters: charactersResponse.data,
        mode: outlineMode,
        microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
        reduceSensitiveContent,
        outlineBatchIndex: 1,
        existingDetailedOutline: '',
      });

      console.log('批量生成：情节细纲成功');
      setOutline(outlineResponse.data);
      setBatchGenerationProgress({ current: 4, total: 4, message: '正在自动保存项目...' });

      // 第四步：自动保存项目
      if (currentProject) {
        updateProject(currentProject.id, {
          bookName: bookName.trim(),
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          detailedOutline: outlineResponse.data,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
        });
      } else {
        const newProject = createProject(bookName.trim(), selectedOutline, {
          worldSetting: worldResponse.data,
          characters: charactersResponse.data,
          detailedOutline: outlineResponse.data,
          detailedOutlineMode: outlineMode,
          microdramaEpisodeCount: outlineMode === 'microdrama' ? microdramaEpisodeCount : undefined,
          reduceSensitiveContent,
          worldSettingNeedsUpgradeSystem: needsUpgradeSystem,
        });
        console.log('批量生成：新项目创建完成，项目ID:', newProject.id);
      }

      setBatchGenerationProgress({ current: 4, total: 4, message: '保存完成' });
      setActiveTab('outline');

      // 更新自动化状态
      if (isAutoFlowRunning && setAutoFlowStep) setAutoFlowStep('世界观、人设与中故事已生成完成');
      if (isAutoFlowRunning && setAutoFlowProgress) setAutoFlowProgress(100);

      console.log('批量生成完成，停留在人设与世界观页面');

    } catch (error) {
      console.error('批量生成失败:', error);
      const errorMessage =
        (error as any)?.response?.data?.message ||
        (error as any)?.message ||
        '批量生成过程中出现错误，请稍后重试';
      alert(errorMessage);
    } finally {
      setBatchGenerating(false);
      setBatchGenerationProgress(null);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-secondary-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={onBack}
                className="p-2 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-secondary-600" />
              </button>
              <div className="p-2 bg-primary-100 rounded-lg">
                <Users className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-secondary-900">人设与世界观</h1>
                <p className="text-sm text-secondary-600">构建完整的世界与人物体系</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 项目管理区域 */}
              <div className="flex items-center space-x-3">
                {/* 书名输入 */}
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium text-secondary-700">书名:</label>
                  <input
                    type="text"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    placeholder="请输入书名"
                    className="px-3 py-1 text-sm border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                {/* 保存按钮 */}
                <button
                  onClick={handleSaveProject}
                  disabled={!canSave}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    showSaveConfirm
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : canSave
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-secondary-300 text-secondary-500 cursor-not-allowed'
                  }`}
                >
                  {showSaveConfirm ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>已保存</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>保存项目</span>
                    </>
                  )}
                </button>

                {/* 项目列表按钮 */}
                <button
                  onClick={() => setShowProjectPanel(true)}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm font-medium hover:bg-secondary-200 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>我的项目 ({projects.length})</span>
                </button>
              </div>

              <div className="flex items-center space-x-2 text-secondary-600">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm">Powered by Gemini 3 Pro</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧配置面板 */}
          <div className="lg:col-span-4 space-y-6">
            {/* 一键生成按钮 */}
            {selectedOutline && bookName.trim() && (
              <div className="card p-6 bg-gradient-to-r from-purple-50 to-primary-50 border-2 border-purple-200">
                <div className="text-center">
                  <div className="inline-flex items-center space-x-3 mb-4">
                    <div className="p-3 bg-purple-100 rounded-full">
                      <Sparkles className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-secondary-900">一键生成完整设定</h2>
                      <p className="text-sm text-secondary-600">自动生成世界观+人物+情节</p>
                    </div>
                  </div>

                  <button
                    onClick={handleBatchGenerate}
                    disabled={batchGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-primary-600 hover:from-purple-700 hover:to-primary-700 text-white py-4 px-6 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
                  >
                    {batchGenerating ? (
                      <div className="flex items-center justify-center space-x-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        <span>生成中...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center space-x-3">
                        <Wand2 className="w-6 h-6" />
                        <span>一键生成全部设定</span>
                        <Sparkles className="w-5 h-5" />
                      </div>
                    )}
                  </button>

                  {/* 进度显示 */}
                  {batchGenerationProgress && (
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2 mb-2">
                        <span className="text-sm font-medium text-secondary-700">
                          {batchGenerationProgress.current}/{batchGenerationProgress.total}
                        </span>
                        <span className="text-sm text-secondary-600">
                          {batchGenerationProgress.message}
                        </span>
                      </div>
                      <div className="w-full bg-secondary-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-purple-600 to-primary-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${(batchGenerationProgress.current / batchGenerationProgress.total) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-secondary-500 mt-4">
                    💡 AI将按顺序生成完整的世界观体系、人物设定和情节框架
                  </div>
                </div>
              </div>
            )}

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <Map className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">世界观基础设定</h2>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-secondary-200 bg-secondary-50 p-4">
                  <div className="text-sm font-medium text-secondary-900 mb-3">升级体系选项</div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setNeedsUpgradeSystem(true)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        needsUpgradeSystem
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
                      }`}
                    >
                      需要升级体系
                    </button>
                    <button
                      onClick={() => setNeedsUpgradeSystem(false)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        !needsUpgradeSystem
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
                      }`}
                    >
                      不需要升级体系
                    </button>
                  </div>
                  <p className="text-xs text-secondary-600 mt-3">
                    都市、现代、现实、豪门、职场、校园等题材，建议关闭修炼升级体系，改走现实向世界观模板。
                  </p>
                </div>
                <button
                  onClick={handleGenerateWorldSetting}
                  disabled={isGeneratingWorldSetting}
                  className="w-full btn btn-primary py-3 disabled:opacity-50"
                >
                  {isGeneratingWorldSetting ? '生成中...' : '生成世界观设定'}
                </button>
                <p className="text-xs text-secondary-600">
                  生成升级体系、地图布局、各大势力介绍等世界观基础元素
                </p>
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  可支撑前200章的故事内容
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <Wand2 className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">AI生成人物</h2>
              </div>

              <div className="space-y-4">
                <label className="flex items-start gap-3 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-3 text-sm text-secondary-700">
                  <input
                    type="checkbox"
                    checked={useEnglishNames}
                    onChange={(e) => setUseEnglishNames(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>
                    <span className="font-medium text-secondary-900">生成英文人物</span>
                    <span className="mt-1 block text-xs text-secondary-600">
                      使用欧美英文名，并排除华裔、俄裔角色设定
                    </span>
                  </span>
                </label>

                <button
                  onClick={handleGenerateCharacters}
                  disabled={isGeneratingCharacters || !worldSettingGenerated}
                  className={`w-full py-3 disabled:opacity-50 ${
                    worldSettingGenerated
                      ? 'btn btn-primary'
                      : 'btn btn-secondary cursor-not-allowed bg-secondary-300 hover:bg-secondary-300'
                  }`}
                >
                  {isGeneratingCharacters ? '生成中...' : '生成人物设定'}
                </button>
                <p className="text-xs text-secondary-600">
                  将根据故事大纲生成20-30个完整人物设定
                </p>
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  包含前200章主要登场人物
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center space-x-3 mb-6">
                <BookOpen className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-secondary-900">情节细纲生成</h2>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-secondary-200 bg-secondary-50 p-4">
                  <div className="text-sm font-medium text-secondary-900 mb-3">生成模式</div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setOutlineMode('novel')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        outlineMode === 'novel'
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
                      }`}
                    >
                      网文情节细纲
                    </button>
                    <button
                      onClick={() => setOutlineMode('microdrama')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        outlineMode === 'microdrama'
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
                      }`}
                    >
                      微短剧大纲
                    </button>
                  </div>
                  {outlineMode === 'microdrama' && (
                    <div className="mt-4 space-y-4">
                      <div className="text-xs font-medium text-secondary-700 mb-2">集数规格</div>
                      <div className="grid grid-cols-3 gap-2">
                        {([30, 60, 100] as const).map((count) => (
                          <button
                            key={count}
                            onClick={() => setMicrodramaEpisodeCount(count)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                              microdramaEpisodeCount === count
                                ? 'bg-primary-100 text-primary-700 border border-primary-300'
                                : 'bg-white text-secondary-700 border border-secondary-200 hover:border-primary-300'
                            }`}
                          >
                            {count}集
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setReduceSensitiveContent(prev => !prev)}
                        className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                          reduceSensitiveContent
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-secondary-200 bg-white text-secondary-700 hover:border-emerald-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">降低审核风险</div>
                            <div className="mt-1 text-xs opacity-80">
                              弱化血腥、敏感、露骨暴力桥段，用关系压迫、身份错位、限时危机和公开打脸替代。
                            </div>
                          </div>
                          <div className={`h-5 w-10 rounded-full p-0.5 transition-colors ${
                            reduceSensitiveContent ? 'bg-emerald-500' : 'bg-secondary-300'
                          }`}>
                            <div className={`h-4 w-4 rounded-full bg-white transition-transform ${
                              reduceSensitiveContent ? 'translate-x-5' : 'translate-x-0'
                            }`}></div>
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleGenerateOutline}
                  disabled={isGeneratingOutline || !charactersGenerated}
                  className={`w-full py-3 disabled:opacity-50 ${
                    charactersGenerated
                      ? 'btn btn-primary'
                      : 'btn btn-secondary cursor-not-allowed bg-secondary-300 hover:bg-secondary-300'
                  }`}
                >
                  {isGeneratingOutline ? '生成中...' : outlineModeMeta.buttonText}
                </button>
                <p className="text-xs text-secondary-600">
                  {outlineModeMeta.generateHint}
                </p>
                <div className="text-xs text-secondary-500">
                  <CheckCircle className="w-3 h-3 inline mr-1" />
                  自动优化情节连贯性
                </div>
              </div>
            </div>

            {/* 前往界面三的按钮 */}
            {outline && (
              <button
                onClick={onNavigateToStructure}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white py-4 px-6 rounded-xl flex items-center justify-center space-x-3 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold text-lg"
              >
                <div className="p-2 bg-white/20 rounded-lg">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="font-bold">前往情节结构细化</div>
                  <div className="text-sm opacity-90">为每个中故事选择微故事卡</div>
                </div>
              </button>
            )}
          </div>

          {/* 右侧内容区域 */}
          <div className="lg:col-span-8">
            {/* 标签页切换 */}
            <div className="mb-6">
              <div className="flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-lg p-1 border border-secondary-200">
                  <button
                    onClick={() => setActiveTab('world')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'world'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <Map className="w-4 h-4" />
                    <span>世界观基础</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('characters')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'characters'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>人物设定</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('outline')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'outline'
                        ? 'bg-primary-500 text-white shadow-sm'
                        : 'text-secondary-600 hover:text-secondary-900'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>{outlineModeMeta.shortName}</span>
                  </button>
              </div>
            </div>

            {/* 内容显示区域 */}
            <div className="min-h-[600px]">
              {/* 世界观基础设定标签页 */}
              {activeTab === 'world' && (
                <div className="card p-6 h-full">
                  {worldSetting || editingSection === 'world' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <Map className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">世界观基础设定结果</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'world' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'world' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('world')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('world')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'world' && (
                        <div className="mb-5 border border-primary-100 bg-primary-50/70 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-primary-900">按批注补充世界观</div>
                              <div className="text-xs text-primary-700 mt-1">AI会基于当前正文补充内容，并插入到合适位置。</div>
                            </div>
                            <button
                              onClick={handleSupplementWorldSetting}
                              disabled={isSupplementingWorldSetting || !supplementNotes.world.trim()}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                            >
                              {isSupplementingWorldSetting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              补充生成
                            </button>
                          </div>
                          <textarea
                            value={supplementNotes.world}
                            onChange={(e) => setSupplementNotes(prev => ({ ...prev, world: e.target.value }))}
                            className="w-full min-h-[84px] p-3 border border-primary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-secondary-800 bg-white"
                            placeholder="写批注：比如补充货币体系、某个宗门的历史、特殊能力代价、城市地下势力规则..."
                          />
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'world' ? (
                          <textarea
                            value={sectionDrafts.world}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, world: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder="可在这里手动修改世界观基础设定"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(worldSetting)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <Map className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        尚未生成世界观基础设定
                      </h3>
                      <p className="text-secondary-600 mb-4">
                        你可以点击下方按钮手动填写，或先走AI生成流程
                      </p>
                      <button
                        onClick={() => startEditSection('world')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>手动填写世界观基础</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 人物设定标签页 */}
              {activeTab === 'characters' && (
                <div className="card p-6 h-full">
                  {characters || editingSection === 'characters' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <Users className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">人物设定结果</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'characters' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'characters' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('characters')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('characters')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'characters' && (
                        <div className="mb-5 border border-primary-100 bg-primary-50/70 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-primary-900">按批注补充人物设定</div>
                              <div className="text-xs text-primary-700 mt-1">AI会基于当前人设补充角色、关系或状态，并插入到合适位置。</div>
                            </div>
                            <button
                              onClick={handleSupplementCharacters}
                              disabled={isSupplementingCharacters || !supplementNotes.characters.trim()}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                            >
                              {isSupplementingCharacters ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                              补充生成
                            </button>
                          </div>
                          <textarea
                            value={supplementNotes.characters}
                            onChange={(e) => setSupplementNotes(prev => ({ ...prev, characters: e.target.value }))}
                            className="w-full min-h-[84px] p-3 border border-primary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-secondary-800 bg-white"
                            placeholder="写批注：比如补充女主当前状态、增加反派阵营、强化主角和师门关系、给配角加隐藏动机..."
                          />
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'characters' ? (
                          <textarea
                            value={sectionDrafts.characters}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, characters: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder="可在这里手动修改人物设定"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(characters)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <Users className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        尚未生成人物设定
                      </h3>
                      <p className="text-secondary-600 mb-4">
                        你可以点击下方按钮手动填写，或先走AI生成流程
                      </p>
                      <button
                        onClick={() => startEditSection('characters')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>手动填写人物设定</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 情节细纲标签页 */}
              {activeTab === 'outline' && (
                <div className="card p-6 h-full">
                  {outline || editingSection === 'outline' ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <FileText className="w-5 h-5 text-primary-600" />
                          <h3 className="text-lg font-semibold text-secondary-900">{outlineModeMeta.resultTitle}</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                          {inlineSaveSection === 'outline' && (
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">已保存修改</span>
                          )}
                          {editingSection === 'outline' ? (
                            <>
                              <button
                                onClick={() => saveEditedSection('outline')}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                              >
                                <Save className="w-4 h-4" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={cancelEditSection}
                                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                              >
                                <X className="w-4 h-4" />
                                <span>取消</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditSection('outline')}
                              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md"
                            >
                              <PenTool className="w-4 h-4" />
                              <span>编辑</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {editingSection !== 'outline' && (
                        <div className="mb-5 border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-amber-900">导入建议后重生成中故事</div>
                              <div className="text-xs text-amber-700 mt-1">
                                会抓住当前情节细纲，结合世界观和人物设定，按建议完整重写所有中故事。
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-sm font-medium cursor-pointer">
                                <Download className="w-4 h-4" />
                                导入建议
                                <input
                                  type="file"
                                  accept=".txt,.md,.json,text/plain,text/markdown,application/json"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    handleImportOutlineSuggestion(file);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                onClick={handleRegenerateOutlineWithSuggestion}
                                disabled={isRegeneratingOutlineWithSuggestion || !outlineRevisionSuggestion.trim()}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                              >
                                {isRegeneratingOutlineWithSuggestion ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                按建议重生成
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={outlineRevisionSuggestion}
                            onChange={(e) => setOutlineRevisionSuggestion(e.target.value)}
                            className="w-full min-h-[96px] p-3 border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm text-secondary-800 bg-white"
                            placeholder="粘贴修改建议，或导入txt/md文件。比如：减少副线、强化男主事业线、保留爱情线但降低血腥桥段、第3个中故事改成更强反转..."
                          />
                        </div>
                      )}
                      <div className="prose prose-sm max-w-none">
                        {editingSection === 'outline' ? (
                          <textarea
                            value={sectionDrafts.outline}
                            onChange={(e) => setSectionDrafts(prev => ({ ...prev, outline: e.target.value }))}
                            className="w-full min-h-[420px] p-3 border border-secondary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-secondary-800 leading-relaxed"
                            placeholder={`可在这里手动修改${outlineModeMeta.shortName}`}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-secondary-700 leading-relaxed">
                            {cleanMarkdownFormatting(outline)}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <FileText className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-secondary-900 mb-2">
                        {outlineModeMeta.emptyTitle}
                      </h3>
                      <p className="text-secondary-600 mb-4">
                        你可以点击下方按钮手动填写，或先走AI生成流程
                      </p>
                      <button
                        onClick={() => startEditSection('outline')}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-secondary-100 hover:bg-secondary-200 text-secondary-700 rounded-md text-sm"
                      >
                        <PenTool className="w-4 h-4" />
                        <span>{outlineModeMeta.emptyActionText}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 默认状态 */}
              {!characters && !outline && (
                <div className="card p-8 text-center">
                  <Sparkles className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-secondary-900 mb-2">
                    世界观与人物体系构建
                  </h3>
                  <p className="text-secondary-600">
                    点击左侧按钮生成人物设定和情节细纲，开始构建完整的故事世界
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 项目管理面板 */}
      {showProjectPanel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
            {/* 面板头部 */}
            <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FolderOpen className="w-6 h-6" />
                  <div>
                    <h2 className="text-xl font-bold">世界设定项目管理</h2>
                    <p className="text-primary-100 text-sm">
                      已保存 {projects.length} 个完整的世界设定项目
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <label
                    className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    title="从导出的JSON文件导入并恢复项目"
                  >
                    <span>导入项目</span>
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        // 允许重复选择同一个文件也触发
                        e.target.value = '';
                        void handleImportProjectFile(file);
                      }}
                    />
                  </label>
                  {projects.length > 0 && (
                    <button
                      onClick={exportAllProjects}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>导出全部</span>
                    </button>
                  )}
                  {projects.length > 0 && (
                    <button
                      onClick={handleClearNovelCacheForAll}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-red-500/90 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
                      title="清空所有项目的已生成正文/版本历史/Writer进度等缓存（保留设定）"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>清空正文缓存</span>
                    </button>
                  )}
                  <button
                    onClick={() => setShowProjectPanel(false)}
                    className="w-8 h-8 flex items-center justify-center bg-primary-500 hover:bg-primary-400 rounded-lg transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* 项目列表 */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {projects.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-secondary-900 mb-2">
                    还没有保存的世界设定项目
                  </h3>
                  <p className="text-secondary-600">
                    完成世界观基础设定、人物设定和情节细纲的生成后，点击"保存项目"来保存完整设定
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${
                        currentProject?.id === project.id ? 'border-primary-300 bg-primary-50' : 'border-secondary-200'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-secondary-900 mb-1">
                            {project.bookName}
                          </h3>
                          <p className="text-sm text-secondary-600 mb-2">
                            基于架构: {project.outline.title}
                          </p>
                          <div className="flex items-center space-x-4 text-xs text-secondary-500">
                            <span className={`flex items-center space-x-1 ${project.worldSetting ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.worldSetting ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>世界观基础</span>
                            </span>
                            <span className={`flex items-center space-x-1 ${project.characters ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.characters ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>人物设定</span>
                            </span>
                            <span className={`flex items-center space-x-1 ${project.detailedOutline ? 'text-green-600' : 'text-red-500'}`}>
                              <div className={`w-2 h-2 rounded-full ${project.detailedOutline ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span>情节细纲</span>
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <button
                            onClick={() => handleLoadProject(project)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700 transition-colors"
                          >
                            <FileText className="w-4 h-4" />
                            <span>加载</span>
                          </button>
                          <button
                            onClick={() => exportProject(project)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-md text-sm hover:bg-secondary-200 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            <span>导出</span>
                          </button>
                          <button
                            onClick={() => handleClearNovelCacheForOne(project.id, project.bookName)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 transition-colors"
                            title="仅清空该项目已生成正文/版本历史/Writer进度（保留设定）"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>清正文</span>
                          </button>
                          <button
                            onClick={() => handleDeleteProject(project.id)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-secondary-500">
                        <div className="flex items-center space-x-1">
                          <span>创建时间: {new Date(project.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                        <span>项目 #{project.id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
