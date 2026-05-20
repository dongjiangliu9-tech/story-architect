import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Clapperboard, Download, FileImage, Image as ImageIcon, Map as MapIcon, Package, RefreshCw, Save, Sparkles, Upload, Users } from 'lucide-react';
import { AssetVisualStyle, CharacterPromptItem, CharacterPromptVariant, PropPromptItem, ScenePromptItem, blueprintApi } from '../services/api';
import { EpisodeAssetInventory, SavedMicroStory, sortSavedMicroStoriesForChapters, useWorldSettings } from '../contexts/WorldSettingsContext';

interface CharacterPromptsPageProps {
  onBack: () => void;
  onNavigateToSeedance: () => void;
}

const CHARACTER_PROMPT_EXAMPLES = [
  '电影写实主义立绘，一名身材极度高大魁梧的中国古代美男子，身高1米9，面容俊朗清秀，眼神深邃锐利。他穿着一套剪裁极具设计感的霜白色绫罗长衫，外罩一件银丝暗纹披风，腰间系着带有大理寺图腾的青铜腰带，挂着一枚温润的古玉。他没有穿黑色衣服，整体色调以白、灰、金为主。他负手而立，站姿挺拔如松，右手虎口有薄茧，透出深厚的武功底蕴。全身照，正面面向镜头，背景为纯净的无影白墙，极高画质，电影级质感。',
  '电影写实主义，一位绝美的中国唐代美女，容貌倾国倾城，神情冷艳且带着一丝神秘。她身穿一套极度华丽、剪裁大胆的暗红色齐胸襦裙，裙摆由多层真丝叠合，上面布满了手工刺绣的彼岸花纹样，腰间缠绕着缀满细碎金铃的丝带。她发髻高耸，插着精致的掐丝金凤步摇，流苏垂至耳畔。皮肤白皙如瓷，眼神中藏着杀机。纯白色背景，全身照，正面面向镜头，电影级写实滤镜，极度复杂的设计感。',
];

const VISUAL_STYLE_OPTIONS: Array<{ value: AssetVisualStyle; label: string; description: string }> = [
  { value: 'live_action', label: '真人微短剧', description: '电影写实主义、真实摄影质感' },
  { value: 'guofeng_2d', label: '2D国风动漫', description: '国风线稿、赛璐璐上色' },
  { value: 'guofeng_3d', label: '3D国风动漫', description: '高精度模型、电影级灯光' },
];

interface ImportedScriptEpisode {
  episode: number;
  title?: string;
  content: string;
}

function parseChineseEpisodeNumber(raw: string): number {
  const value = String(raw || '').trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (digitMap[value.slice(1)] || 0);
  const tenIndex = value.indexOf('十');
  if (tenIndex > 0) {
    const tens = digitMap[value.slice(0, tenIndex)] || 1;
    const ones = digitMap[value.slice(tenIndex + 1)] || 0;
    return tens * 10 + ones;
  }
  return digitMap[value] || 0;
}

function splitImportedScript(text: string, fallbackStartEpisode: number): ImportedScriptEpisode[] {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];
  const boundaryPattern = /(?:^|\n)\s*第\s*([0-9一二两三四五六七八九十〇零]{1,6})\s*集\s*[：:、.-]?\s*([^\n]*)/g;
  const matches = Array.from(source.matchAll(boundaryPattern));
  if (matches.length === 0) {
    return [{ episode: fallbackStartEpisode, title: '外部导入剧本', content: source }];
  }
  return matches.map((match, index) => {
    const nextMatch = matches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = nextMatch?.index ?? source.length;
    const episode = parseChineseEpisodeNumber(match[1]) || fallbackStartEpisode + index;
    const body = source.slice(start, end).trim();
    const title = String(match[2] || '').trim() || `外部导入第${episode}集`;
    return {
      episode,
      title,
      content: `第${episode}集${title ? `：${title}` : ''}\n${body}`.trim(),
    };
  }).filter(item => item.content.trim());
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function inflateZipEntry(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;
  if (method !== 8) {
    throw new Error('暂不支持这个docx压缩格式');
  }
  const DecompressionStreamCtor = (globalThis as any).DecompressionStream;
  if (!DecompressionStreamCtor) {
    throw new Error('当前浏览器不支持直接解析docx，请先另存为txt或md导入。');
  }
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStreamCtor('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder('utf-8');
  let offset = 0;
  while (offset + 30 < buffer.length) {
    const signature = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buffer[offset + 8] | (buffer[offset + 9] << 8);
    const compressedSize = buffer[offset + 18] | (buffer[offset + 19] << 8) | (buffer[offset + 20] << 16) | (buffer[offset + 21] << 24);
    const fileNameLength = buffer[offset + 26] | (buffer[offset + 27] << 8);
    const extraLength = buffer[offset + 28] | (buffer[offset + 29] << 8);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const fileName = decoder.decode(buffer.slice(nameStart, nameStart + fileNameLength));
    if (fileName === 'word/document.xml') {
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      const inflated = await inflateZipEntry(compressed, method);
      const xml = decoder.decode(inflated);
      return decodeXmlText(xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim());
    }
    offset = dataStart + Math.max(compressedSize, 0);
  }
  throw new Error('没有在docx中找到正文内容');
}

function extractEpisodeNumber(story: SavedMicroStory | undefined, fallback: number): number {
  const text = `${story?.title || ''}\n${story?.content || ''}`;
  const match = text.match(/第\s*(\d{1,4})\s*集/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeFileNamePart(name: string): string {
  return (name || '未命名资产')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || '未命名资产';
}

function getExtension(fileName: string): string {
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || 'png';
}

function getCharacterPromptId(item: CharacterPromptItem, index: number): string {
  return `${item.name || '角色'}-${(item.episodeNumbers || []).join('_') || 'all'}-${index}`;
}

function getBaseVariantId(item: CharacterPromptItem): string {
  return `${item.id || item.name || 'character'}__base`;
}

function getCharacterVariants(item: CharacterPromptItem): CharacterPromptVariant[] {
  const baseVariant: CharacterPromptVariant = {
    id: getBaseVariantId(item),
    name: '默认造型',
    prompt: item.prompt,
    promptNote: item.promptNote,
    visualBrief: item.visualBrief,
    imageDataUrl: item.imageDataUrl,
    imageFileName: item.imageFileName,
    imageOriginalName: item.imageOriginalName,
  };
  return [baseVariant, ...(item.variants || [])];
}

function getActiveCharacterVariant(item: CharacterPromptItem, episode: number): CharacterPromptVariant {
  const variants = getCharacterVariants(item);
  const activeId = item.activeVariantIdByEpisode?.[String(episode)];
  return variants.find(variant => variant.id === activeId) || variants[0];
}

function getScenePromptId(item: ScenePromptItem, index: number): string {
  return `${item.name || '场景'}-${(item.episodeNumbers || [item.episodeNumber]).join('_') || 'all'}-${index}`;
}

function getPropPromptId(item: PropPromptItem, index: number): string {
  return `${item.name || '道具'}-${(item.episodeNumbers || []).join('_') || 'all'}-${index}`;
}

function normalizeAssetKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[第集章节幕场镜头号：:，,。.\s"'“”‘’《》<>【】[\]（）()_-]+/g, '');
}

function uniqNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.map(Number).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
}

function getSceneEpisodes(scene: ScenePromptItem): number[] {
  return uniqNumbers([...(scene.episodeNumbers || []), scene.episodeNumber]);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data] = dataUrl.split(',');
  const mime = meta?.match(/data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

async function writeTextFile(directoryHandle: any, fileName: string, text: string) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([text], { type: 'application/json;charset=utf-8' }));
  await writable.close();
}

async function writeBlobFile(directoryHandle: any, fileName: string, blob: Blob) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function toChineseImageLabel(index: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (index <= 10) return `图${index === 10 ? '十' : digits[index]}`;
  if (index < 20) return `图十${digits[index - 10]}`;
  const tens = Math.floor(index / 10);
  const ones = index % 10;
  return `图${digits[tens]}十${ones ? digits[ones] : ''}`;
}

export function CharacterPromptsPage({ onBack, onNavigateToSeedance }: CharacterPromptsPageProps) {
  const { currentProject, updateProject } = useWorldSettings();
  const [visualStyle, setVisualStyle] = useState<AssetVisualStyle>('live_action');
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [characters, setCharacters] = useState<CharacterPromptItem[]>([]);
  const [scenes, setScenes] = useState<ScenePromptItem[]>([]);
  const [props, setProps] = useState<PropPromptItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [episodeInventories, setEpisodeInventories] = useState<EpisodeAssetInventory[]>([]);
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [supplementEpisode, setSupplementEpisode] = useState<number | ''>('');
  const [supplementType, setSupplementType] = useState<'character' | 'scene' | 'prop'>('character');
  const [supplementNote, setSupplementNote] = useState('');
  const [supplementNoPeople, setSupplementNoPeople] = useState(true);
  const [importedScriptText, setImportedScriptText] = useState('');
  const [importedEpisodes, setImportedEpisodes] = useState<ImportedScriptEpisode[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSupplementing, setIsSupplementing] = useState(false);

  const isMicrodrama = currentProject?.detailedOutlineMode === 'microdrama';
  const generatedChapters = currentProject?.generatedChapters || {};
  const storyEntries = useMemo(() => {
    const stories = sortSavedMicroStoriesForChapters(currentProject?.savedMicroStories || []);
    return stories.map((story, index) => ({
      story,
      episode: extractEpisodeNumber(story, index + 1),
    }));
  }, [currentProject?.savedMicroStories]);

  const generatedEpisodeNumbers = useMemo(() => (
    Object.keys(generatedChapters)
      .map(Number)
      .filter(episode => Number.isFinite(episode) && generatedChapters[episode]?.trim())
      .sort((a, b) => a - b)
  ), [generatedChapters]);

  const availableEpisodes = useMemo(() => (
    [...new Set([...generatedEpisodeNumbers, ...importedEpisodes.map(item => item.episode)])].sort((a, b) => a - b)
  ), [generatedEpisodeNumbers, importedEpisodes]);

  const importedEpisodeMap = useMemo(() => (
    new Map(importedEpisodes.map(item => [item.episode, item]))
  ), [importedEpisodes]);

  const getStoryForEpisode = (episode: number) => storyEntries.find(item => item.episode === episode)?.story;

  const getEpisodeContent = (episode: number) => importedEpisodeMap.get(episode)?.content || generatedChapters[episode] || '';

  const getEpisodeTitle = (episode: number) => importedEpisodeMap.get(episode)?.title || getStoryForEpisode(episode)?.title;

  const allSavedCharacters = useMemo(() => {
    const saved = (currentProject?.characterPromptPacks || []).flatMap(pack => pack.characters || []);
    return [...saved, ...characters];
  }, [characters, currentProject?.characterPromptPacks]);

  const allSavedScenes = useMemo(() => {
    const saved = (currentProject?.characterPromptPacks || []).flatMap(pack => pack.scenes || []);
    return [...saved, ...scenes];
  }, [scenes, currentProject?.characterPromptPacks]);

  const allSavedProps = useMemo(() => {
    const saved = (currentProject?.characterPromptPacks || []).flatMap(pack => pack.props || []);
    return [...saved, ...props];
  }, [props, currentProject?.characterPromptPacks]);

  const mergeCharactersWithLibrary = (incoming: CharacterPromptItem[]): CharacterPromptItem[] => {
    const byKey = new Map<string, CharacterPromptItem>();
    const add = (item: CharacterPromptItem) => {
      const keys = [item.name, ...(item.aliases || [])].map(normalizeAssetKey).filter(Boolean);
      const existing = keys.map(key => byKey.get(key)).find(Boolean);
      const merged = existing
        ? {
            ...item,
            ...existing,
            aliases: [...new Set([...(existing.aliases || []), ...(item.aliases || [])])],
            episodeNumbers: uniqNumbers([...(existing.episodeNumbers || []), ...(item.episodeNumbers || [])]),
            plotBasis: item.plotBasis || existing.plotBasis,
            roleBrief: existing.roleBrief || item.roleBrief,
            visualBrief: existing.visualBrief || item.visualBrief,
          }
        : { ...item, episodeNumbers: uniqNumbers(item.episodeNumbers || []) };
      keys.forEach(key => byKey.set(key, merged));
    };
    allSavedCharacters.forEach(add);
    incoming.forEach(add);
    const seen = new Set<string>();
    return Array.from(byKey.values()).filter(item => {
      const key = normalizeAssetKey(item.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const mergeScenesWithLibrary = (incoming: ScenePromptItem[]): ScenePromptItem[] => {
    const byKey = new Map<string, ScenePromptItem>();
    const add = (item: ScenePromptItem) => {
      const key = normalizeAssetKey(`${item.name}-${item.sceneBrief || ''}`);
      const existing = byKey.get(key) || byKey.get(normalizeAssetKey(item.name));
      const episodes = uniqNumbers([
        ...getSceneEpisodes(existing || item),
        ...getSceneEpisodes(item),
      ]);
      const merged = existing
        ? { ...item, ...existing, episodeNumbers: episodes, episodeNumber: episodes[0] || item.episodeNumber, plotBasis: item.plotBasis || existing.plotBasis }
        : { ...item, episodeNumbers: episodes, episodeNumber: episodes[0] || item.episodeNumber };
      byKey.set(key || normalizeAssetKey(item.name), merged);
      byKey.set(normalizeAssetKey(item.name), merged);
    };
    allSavedScenes.forEach(add);
    incoming.forEach(add);
    const seen = new Set<string>();
    return Array.from(byKey.values()).filter(item => {
      const key = normalizeAssetKey(`${item.name}-${item.sceneBrief || ''}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const mergePropsWithLibrary = (incoming: PropPromptItem[]): PropPromptItem[] => {
    const byKey = new Map<string, PropPromptItem>();
    const add = (item: PropPromptItem) => {
      const key = normalizeAssetKey(item.name);
      const existing = byKey.get(key);
      const merged = existing
        ? {
            ...item,
            ...existing,
            episodeNumbers: uniqNumbers([...(existing.episodeNumbers || []), ...(item.episodeNumbers || [])]),
            plotBasis: item.plotBasis || existing.plotBasis,
          }
        : { ...item, episodeNumbers: uniqNumbers(item.episodeNumbers || []) };
      if (key) byKey.set(key, merged);
    };
    allSavedProps.forEach(add);
    incoming.forEach(add);
    return Array.from(byKey.values());
  };

  const buildInventories = (
    targetEpisodes: number[],
    nextCharacters = characters,
    nextScenes = scenes,
    nextProps = props,
  ): EpisodeAssetInventory[] => {
    const now = new Date().toISOString();
    return targetEpisodes.map(episode => {
      const characterAssetIds = nextCharacters
        .map((item, index) => ({ item, id: getCharacterPromptId(item, index) }))
        .filter(({ item }) => (item.episodeNumbers || []).includes(episode))
        .map(({ id }) => id);
      const sceneAssetIds = nextScenes
        .map((item, index) => ({ item, id: getScenePromptId(item, index) }))
        .filter(({ item }) => getSceneEpisodes(item).includes(episode))
        .map(({ id }) => id);
      const propAssetIds = nextProps
        .map((item, index) => ({ item, id: getPropPromptId(item, index) }))
        .filter(({ item }) => (item.episodeNumbers || []).includes(episode))
        .map(({ id }) => id);
      const missingImageNames = [
        ...nextCharacters.filter(item => (item.episodeNumbers || []).includes(episode) && !getActiveCharacterVariant(item, episode).imageDataUrl).map(item => `人物：${item.name}`),
        ...nextScenes.filter(item => getSceneEpisodes(item).includes(episode) && !item.imageDataUrl).map(item => `场景：${item.name}`),
        ...nextProps.filter(item => (item.episodeNumbers || []).includes(episode) && !item.imageDataUrl).map(item => `道具：${item.name}`),
      ];
      return { episodeNumber: episode, characterAssetIds, sceneAssetIds, propAssetIds, missingImageNames, updatedAt: now };
    });
  };

  useEffect(() => {
    const latestPack = currentProject?.characterPromptPacks?.[0];
    if (latestPack?.characters?.length) {
      setCharacters(latestPack.characters);
      setScenes(latestPack.scenes || []);
      setProps(latestPack.props || []);
      setEpisodeInventories(latestPack.episodeInventories || []);
      setVisualStyle(latestPack.visualStyle || 'live_action');
      setSelectedEpisodes(prev => {
        if (prev.length > 0) return prev;
        return latestPack.episodeNumbers?.length ? latestPack.episodeNumbers : availableEpisodes.slice(0, 1);
      });
      setSelectedIds(new Set(latestPack.characters.map((item, index) => getCharacterPromptId(item, index))));
      setSelectedSceneIds(new Set((latestPack.scenes || []).map((item, index) => getScenePromptId(item, index))));
      setSelectedPropIds(new Set((latestPack.props || []).map((item, index) => getPropPromptId(item, index))));
      setSummary(latestPack.summary || '');
      return;
    }
    if (availableEpisodes.length > 0 && selectedEpisodes.length === 0) {
      const preferred = Number(localStorage.getItem('story-architect-character-prompts-default-episode') || 0);
      setSelectedEpisodes([availableEpisodes.includes(preferred) ? preferred : availableEpisodes[0]]);
    }
  }, [availableEpisodes, currentProject?.characterPromptPacks, selectedEpisodes.length]);

  const toggleEpisode = (episode: number) => {
    setSelectedEpisodes(prev => (
      prev.includes(episode)
        ? prev.filter(item => item !== episode)
        : [...prev, episode].sort((a, b) => a - b)
    ));
  };

  const parseImportedScript = (text = importedScriptText) => {
    const fallbackStart = Math.max(0, ...availableEpisodes, ...generatedEpisodeNumbers) + 1;
    const episodes = splitImportedScript(text, fallbackStart || 1);
    if (episodes.length === 0) {
      alert('请先粘贴或导入剧本正文');
      return;
    }
    setImportedEpisodes(episodes);
    setSelectedEpisodes(episodes.map(item => item.episode));
  };

  const importExternalScriptFile = async (file: File | null) => {
    if (!file) return;
    try {
      const lowerName = file.name.toLowerCase();
      const text = lowerName.endsWith('.docx')
        ? await extractDocxText(file)
        : await file.text();
      setImportedScriptText(text);
      parseImportedScript(text);
    } catch (error) {
      console.error('导入外部剧本失败:', error);
      alert((error as any)?.message || '导入失败，请换成txt、md或标准docx文件再试。');
    }
  };

  const generatePrompts = async () => {
    if (!currentProject) return;
    const episodes = selectedEpisodes.filter(episode => getEpisodeContent(episode).trim());
    if (episodes.length === 0) {
      alert('请至少选择一集已生成正文或外部导入正文');
      return;
    }
    setIsGenerating(true);
    try {
      const response = await blueprintApi.generateCharacterPrompts({
        bookName: currentProject.bookName,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        promptExamples: CHARACTER_PROMPT_EXAMPLES,
        visualStyle,
        existingCharacters: allSavedCharacters,
        existingScenes: allSavedScenes,
        existingProps: allSavedProps,
        episodes: episodes.map(episode => {
          const story = getStoryForEpisode(episode);
          return {
            episode,
            title: getEpisodeTitle(episode),
            outline: story?.content,
            content: getEpisodeContent(episode),
          };
        }),
      });
      const nextCharacters = mergeCharactersWithLibrary(response.data.characters || []);
      const nextScenes = mergeScenesWithLibrary(response.data.scenes || []);
      const nextProps = mergePropsWithLibrary(response.data.props || []);
      const nextInventories = buildInventories(episodes, nextCharacters, nextScenes, nextProps);
      setCharacters(nextCharacters);
      setScenes(nextScenes);
      setProps(nextProps);
      setEpisodeInventories(nextInventories);
      setSummary(response.data.summary || '');
      setSelectedIds(new Set(nextCharacters.map((item, index) => getCharacterPromptId(item, index))));
      setSelectedSceneIds(new Set(nextScenes.map((item, index) => getScenePromptId(item, index))));
      setSelectedPropIds(new Set(nextProps.map((item, index) => getPropPromptId(item, index))));
    } catch (error) {
      console.error('生成人物提示词失败:', error);
      alert((error as any)?.response?.data?.message || (error as any)?.message || '人物提示词生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const updateCharacterAt = (index: number, patch: Partial<CharacterPromptItem>) => {
    setCharacters(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const updateSceneAt = (index: number, patch: Partial<ScenePromptItem>) => {
    setScenes(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const updatePropAt = (index: number, patch: Partial<PropPromptItem>) => {
    setProps(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const revisePrompt = async (index: number, action: 'regenerate' | 'tune') => {
    if (!currentProject) return;
    const item = characters[index];
    const id = getCharacterPromptId(item, index);
    const note = (notes[id] || '').trim();
    if (!note) {
      alert('请先给这个人物写备注，再重新生成或微调提示词。');
      return;
    }

    setBusyKey(`${id}-${action}`);
    try {
      const response = await blueprintApi.reviseCharacterPrompt({
        character: item,
        action,
        note,
        visualStyle,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        promptExamples: CHARACTER_PROMPT_EXAMPLES,
      });
      updateCharacterAt(index, response.data);
    } catch (error) {
      console.error('修订人物提示词失败:', error);
      alert((error as any)?.response?.data?.message || (error as any)?.message || '人物提示词修订失败，请稍后重试');
    } finally {
      setBusyKey(null);
    }
  };

  const createCharacterVariant = async (index: number) => {
    if (!currentProject) return;
    const item = characters[index];
    const id = getCharacterPromptId(item, index);
    const note = (notes[id] || '').trim();
    if (!note) {
      alert('请先写备注，例如：第二版造型，换成夜行衣、束发、少一点华丽感。');
      return;
    }
    setBusyKey(`${id}-variant`);
    try {
      const response = await blueprintApi.reviseCharacterPrompt({
        character: item,
        action: 'regenerate',
        note: `生成一个新的独立造型版本，不覆盖原造型。这个版本的要求是：${note}`,
        visualStyle,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        promptExamples: CHARACTER_PROMPT_EXAMPLES,
      });
      const versionNumber = (item.variants || []).length + 2;
      const variant: CharacterPromptVariant = {
        id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: `第${versionNumber}版造型`,
        prompt: response.data.prompt,
        promptNote: note,
        visualBrief: response.data.visualBrief || item.visualBrief,
      };
      updateCharacterAt(index, {
        variants: [...(item.variants || []), variant],
      });
    } catch (error) {
      console.error('生成造型版本失败:', error);
      alert((error as any)?.response?.data?.message || (error as any)?.message || '造型版本生成失败，请稍后重试');
    } finally {
      setBusyKey(null);
    }
  };

  const setCharacterVariantForEpisode = (index: number, episode: number, variantId: string) => {
    const item = characters[index];
    updateCharacterAt(index, {
      activeVariantIdByEpisode: {
        ...(item.activeVariantIdByEpisode || {}),
        [String(episode)]: variantId,
      },
    });
  };

  const importImageForCharacter = (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const item = characters[index];
      const renamed = `${safeFileNamePart(item.name)}.${getExtension(file.name)}`;
      updateCharacterAt(index, {
        imageDataUrl: String(reader.result || ''),
        imageFileName: renamed,
        imageOriginalName: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const importImageForCharacterVariant = (characterIndex: number, variantId: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const item = characters[characterIndex];
      const renamed = `${safeFileNamePart(`${item.name}_${getCharacterVariants(item).find(variant => variant.id === variantId)?.name || '造型'}`)}.${getExtension(file.name)}`;
      if (variantId === getBaseVariantId(item)) {
        updateCharacterAt(characterIndex, {
          imageDataUrl: String(reader.result || ''),
          imageFileName: renamed,
          imageOriginalName: file.name,
        });
        return;
      }
      updateCharacterAt(characterIndex, {
        variants: (item.variants || []).map(variant => variant.id === variantId
          ? {
              ...variant,
              imageDataUrl: String(reader.result || ''),
              imageFileName: renamed,
              imageOriginalName: file.name,
            }
          : variant),
      });
    };
    reader.readAsDataURL(file);
  };

  const importImageForScene = (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const item = scenes[index];
      const renamed = `${safeFileNamePart(item.name)}.${getExtension(file.name)}`;
      updateSceneAt(index, {
        imageDataUrl: String(reader.result || ''),
        imageFileName: renamed,
        imageOriginalName: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const importImageForProp = (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const item = props[index];
      const renamed = `${safeFileNamePart(item.name)}.${getExtension(file.name)}`;
      updatePropAt(index, {
        imageDataUrl: String(reader.result || ''),
        imageFileName: renamed,
        imageOriginalName: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const toggleCharacter = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleScene = (id: string) => {
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProp = (id: string) => {
    setSelectedPropIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateSupplementalAsset = async () => {
    if (!currentProject) return;
    const episodeNumber = Number(supplementEpisode || selectedEpisodes[0] || availableEpisodes[0]);
    if (!Number.isFinite(episodeNumber) || !getEpisodeContent(episodeNumber).trim()) {
      alert('请先选择一集已生成正文或外部导入正文');
      return;
    }
    if (!supplementNote.trim()) {
      alert('请填写补充设定');
      return;
    }

    const story = getStoryForEpisode(episodeNumber);
    setIsSupplementing(true);
    try {
      const response = await blueprintApi.generateSupplementalAssetPrompt({
        assetType: supplementType,
        visualStyle,
        noPeople: supplementType === 'scene' ? supplementNoPeople : undefined,
        note: supplementNote,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        promptExamples: CHARACTER_PROMPT_EXAMPLES,
        episode: {
          episode: episodeNumber,
          title: getEpisodeTitle(episodeNumber),
          outline: story?.content,
          content: getEpisodeContent(episodeNumber),
        },
      });
      if (response.data.character) {
        setCharacters(prev => [...prev, response.data.character as CharacterPromptItem]);
      }
      if (response.data.scene) {
        setScenes(prev => [...prev, response.data.scene as ScenePromptItem]);
      }
      if (response.data.prop) {
        setProps(prev => [...prev, response.data.prop as PropPromptItem]);
      }
      setSupplementNote('');
    } catch (error) {
      console.error('补充生成资产失败:', error);
      alert((error as any)?.response?.data?.message || (error as any)?.message || '补充生成失败，请稍后重试');
    } finally {
      setIsSupplementing(false);
    }
  };

  const persistCurrentPack = (showAlert = true): boolean => {
    if (!currentProject) return false;
    const selectedCharacters = characters.filter((item, index) => selectedIds.has(getCharacterPromptId(item, index)));
    const selectedScenes = scenes.filter((item, index) => selectedSceneIds.has(getScenePromptId(item, index)));
    const selectedProps = props.filter((item, index) => selectedPropIds.has(getPropPromptId(item, index)));
    if (selectedCharacters.length === 0 && selectedScenes.length === 0 && selectedProps.length === 0) {
      if (showAlert) alert('请至少选择一个人物、场景或道具再保存');
      return false;
    }
    const inventories = buildInventories([...selectedEpisodes].sort((a, b) => a - b), selectedCharacters, selectedScenes, selectedProps);
    const pack = {
      id: `character_prompt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      episodeNumbers: [...selectedEpisodes].sort((a, b) => a - b),
      visualStyle,
      characters: selectedCharacters,
      scenes: selectedScenes,
      props: selectedProps,
      episodeInventories: inventories,
      summary,
    };
    updateProject(currentProject.id, {
      characterPromptPacks: [pack, ...(currentProject.characterPromptPacks || [])].slice(0, 20),
    });
    setEpisodeInventories(inventories);
    if (showAlert) alert(`已保存 ${selectedCharacters.length} 个人物资产、${selectedScenes.length} 个场景资产、${selectedProps.length} 个道具资产。`);
    return true;
  };

  const savePack = () => {
    persistCurrentPack(true);
  };

  const continueToSeedance = () => {
    if (persistCurrentPack(false)) {
      onNavigateToSeedance();
    }
  };

  const exportProjectAssetPackage = async () => {
    if (!currentProject) return;
    const selectedCharacters = characters.filter((item, index) => selectedIds.has(getCharacterPromptId(item, index)));
    const selectedScenes = scenes.filter((item, index) => selectedSceneIds.has(getScenePromptId(item, index)));
    const selectedProps = props.filter((item, index) => selectedPropIds.has(getPropPromptId(item, index)));
    if (selectedCharacters.length === 0 && selectedScenes.length === 0 && selectedProps.length === 0) {
      alert('请先选择并保存要进入项目资源包的资产。');
      return;
    }

    const targetEpisodes = selectedEpisodes.length ? [...selectedEpisodes].sort((a, b) => a - b) : availableEpisodes.slice(0, 1);
    const inventories = buildInventories(targetEpisodes, selectedCharacters, selectedScenes, selectedProps);
    const pack = {
      id: `character_prompt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      episodeNumbers: targetEpisodes,
      visualStyle,
      characters: selectedCharacters,
      scenes: selectedScenes,
      props: selectedProps,
      episodeInventories: inventories,
      summary,
    };
    const projectForExport = {
      ...currentProject,
      characterPromptPacks: [pack, ...(currentProject.characterPromptPacks || [])].slice(0, 20),
      updatedAt: new Date().toISOString(),
    };
    updateProject(currentProject.id, {
      characterPromptPacks: projectForExport.characterPromptPacks,
    });
    setEpisodeInventories(inventories);

    const picker = (window as any).showDirectoryPicker;
    if (!picker) {
      const bundle = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        app: 'story-architect',
        type: 'project',
        project: projectForExport,
        localState: {
          writerState: JSON.parse(localStorage.getItem(`writer-state-${currentProject.id}`) || 'null'),
        },
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileNamePart(currentProject.bookName)}_项目资源包.json`;
      link.click();
      URL.revokeObjectURL(url);
      alert('当前浏览器不支持导出文件夹，已导出带图片DataURL的项目JSON。');
      return;
    }

    try {
      const parentHandle = await picker();
      const rootName = `${safeFileNamePart(currentProject.bookName)}_项目资源包`;
      const rootHandle = await parentHandle.getDirectoryHandle(rootName, { create: true });
      const bundle = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        app: 'story-architect',
        type: 'project',
        project: projectForExport,
        localState: {
          writerState: JSON.parse(localStorage.getItem(`writer-state-${currentProject.id}`) || 'null'),
        },
        assetPackage: {
          version: 1,
          description: '项目JSON内已包含图片DataURL；素材文件夹用于人工检查和视频工具引用。',
        },
      };
      await writeTextFile(rootHandle, `${safeFileNamePart(currentProject.bookName)}_项目.json`, JSON.stringify(bundle, null, 2));

      const assetsRoot = await rootHandle.getDirectoryHandle('素材图片', { create: true });
      const allAssets = [
        ...selectedCharacters.flatMap(item => (item.episodeNumbers || []).map(episode => {
          const variant = getActiveCharacterVariant(item, episode);
          return {
            assetType: 'character' as const,
            name: `${item.name}（${variant.name}）`,
            episodeNumbers: [episode],
            imageDataUrl: variant.imageDataUrl,
            imageFileName: variant.imageFileName,
          };
        })),
        ...selectedScenes.map(item => ({ assetType: 'scene' as const, name: item.name, episodeNumbers: getSceneEpisodes(item), imageDataUrl: item.imageDataUrl, imageFileName: item.imageFileName })),
        ...selectedProps.map(item => ({ assetType: 'prop' as const, name: item.name, episodeNumbers: item.episodeNumbers || [], imageDataUrl: item.imageDataUrl, imageFileName: item.imageFileName })),
      ];

      for (const episode of targetEpisodes) {
        const episodeDir = await assetsRoot.getDirectoryHandle(`第${episode}集`, { create: true });
        let imageIndex = 1;
        const manifest: Array<Record<string, string>> = [];
        for (const asset of allAssets.filter(item => item.episodeNumbers.includes(episode) && item.imageDataUrl)) {
          const extension = getExtension(asset.imageFileName || `${asset.name}.png`);
          const label = toChineseImageLabel(imageIndex++);
          const fileName = `${label}.${extension}`;
          await writeBlobFile(episodeDir, fileName, dataUrlToBlob(asset.imageDataUrl || ''));
          manifest.push({
            label,
            fileName,
            assetType: asset.assetType,
            name: asset.name,
            originalFileName: asset.imageFileName || '',
          });
        }
        await writeTextFile(episodeDir, '素材清单.json', JSON.stringify(manifest, null, 2));
      }
      alert('项目资源包已导出：项目JSON、素材图片和每集素材清单都在同一个文件夹里。');
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return;
      console.error('导出项目资源包失败:', error);
      alert('导出项目资源包失败，请稍后重试。');
    }
  };

  const exportCurrentAssets = async () => {
    const targetEpisodes = selectedEpisodes.length ? selectedEpisodes : availableEpisodes.slice(0, 1);
    const selectedCharacters = characters.filter((item, index) => selectedIds.has(getCharacterPromptId(item, index)));
    const selectedScenes = scenes.filter((item, index) => selectedSceneIds.has(getScenePromptId(item, index)));
    const selectedProps = props.filter((item, index) => selectedPropIds.has(getPropPromptId(item, index)));
    const assets = [
      ...selectedCharacters.flatMap((item, index) => (item.episodeNumbers || []).map(episode => {
        const variant = getActiveCharacterVariant(item, episode);
        return {
          assetType: 'character' as const,
          id: `${getCharacterPromptId(item, index)}-${episode}-${variant.id}`,
          name: `${item.name}（${variant.name}）`,
          episodeNumbers: [episode],
          imageDataUrl: variant.imageDataUrl,
          imageFileName: variant.imageFileName,
        };
      })),
      ...selectedScenes.map((item, index) => ({ assetType: 'scene' as const, id: getScenePromptId(item, index), name: item.name, episodeNumbers: getSceneEpisodes(item), imageDataUrl: item.imageDataUrl, imageFileName: item.imageFileName })),
      ...selectedProps.map((item, index) => ({ assetType: 'prop' as const, id: getPropPromptId(item, index), name: item.name, episodeNumbers: item.episodeNumbers || [], imageDataUrl: item.imageDataUrl, imageFileName: item.imageFileName })),
    ].filter(item => item.imageDataUrl);

    if (assets.length === 0) {
      alert('当前选中的资产还没有可导出的图片。');
      return;
    }

    const manifest = targetEpisodes.map(episode => {
      let imageIndex = 1;
      return {
        episode,
        files: assets
          .filter(asset => asset.episodeNumbers.includes(episode))
          .map(asset => {
            const extension = getExtension(asset.imageFileName || `${asset.name}.png`);
            const label = toChineseImageLabel(imageIndex++);
            return {
              label,
              fileName: `${label}.${extension}`,
              assetType: asset.assetType,
              name: asset.name,
              originalFileName: asset.imageFileName || '',
            };
          }),
      };
    });

    const picker = (window as any).showDirectoryPicker;
    if (picker) {
      try {
        const rootHandle = await picker();
        const folderName = `${safeFileNamePart(currentProject?.bookName || '微短剧')}_第${targetEpisodes[0]}-${targetEpisodes[targetEpisodes.length - 1]}集素材`;
        const root = await rootHandle.getDirectoryHandle(folderName, { create: true });
        for (const episodeManifest of manifest) {
          const episodeDir = await root.getDirectoryHandle(`第${episodeManifest.episode}集`, { create: true });
          for (const file of episodeManifest.files) {
            const asset = assets.find(item => item.name === file.name && item.assetType === file.assetType);
            if (!asset?.imageDataUrl) continue;
            const fileHandle = await episodeDir.getFileHandle(file.fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(dataUrlToBlob(asset.imageDataUrl));
            await writable.close();
          }
          const manifestHandle = await episodeDir.getFileHandle('素材清单.json', { create: true });
          const manifestWritable = await manifestHandle.createWritable();
          await manifestWritable.write(new Blob([JSON.stringify(episodeManifest.files, null, 2)], { type: 'application/json' }));
          await manifestWritable.close();
        }
        alert('当前素材已导出，并按每集重命名为图一、图二、图三格式。');
        return;
      } catch (error) {
        if ((error as any)?.name === 'AbortError') return;
        console.error('目录导出失败，改用浏览器下载:', error);
      }
    }

    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    const link = document.createElement('a');
    link.href = manifestUrl;
    link.download = `${safeFileNamePart(currentProject?.bookName || '微短剧')}_素材清单.json`;
    link.click();
    URL.revokeObjectURL(manifestUrl);
    alert('当前浏览器不支持直接导出文件夹，已先导出素材清单。请在 Chrome/Edge 中使用可导出文件夹模式。');
  };

  if (!currentProject || !isMicrodrama) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100 flex items-center justify-center">
        <div className="card p-8 text-center">
          <Users className="w-14 h-14 text-secondary-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-secondary-900">未找到微短剧项目</h2>
          <button onClick={onBack} className="mt-5 btn btn-primary">返回剧本写作</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-sm border-b border-secondary-200">
        <div className="w-full px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-secondary-700" title="返回剧本写作">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-secondary-900">人物、场景与道具提示词资产</h1>
              <p className="text-xs text-secondary-600">先选视觉模式，再从微短剧正文导入资产库，后续集数会自动复用已有图片。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportCurrentAssets}
              disabled={selectedIds.size === 0 && selectedSceneIds.size === 0 && selectedPropIds.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-secondary-200 hover:bg-secondary-50 disabled:bg-gray-100 disabled:text-gray-400 text-secondary-700 text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              导出素材图片
            </button>
            <button
              onClick={exportProjectAssetPackage}
              disabled={selectedIds.size === 0 && selectedSceneIds.size === 0 && selectedPropIds.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-secondary-200 hover:bg-secondary-50 disabled:bg-gray-100 disabled:text-gray-400 text-secondary-700 text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              导出项目资源包
            </button>
            <button
              onClick={continueToSeedance}
              disabled={characters.length === 0 && scenes.length === 0 && props.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
            >
              <ArrowRight className="w-4 h-4" />
              进入SeeDance细化
            </button>
            <button
              onClick={savePack}
              disabled={(characters.length === 0 && scenes.length === 0 && props.length === 0) || (selectedIds.size === 0 && selectedSceneIds.size === 0 && selectedPropIds.size === 0)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              保存资产到项目
            </button>
          </div>
        </div>
      </header>

      <main className="w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-3 space-y-5">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">视觉模式</h2>
              <div className="space-y-2">
                {VISUAL_STYLE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisualStyle(option.value)}
                    disabled={isGenerating || isSupplementing}
                    className={`w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                      visualStyle === option.value
                        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100'
                        : 'border-secondary-200 bg-white hover:bg-secondary-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-secondary-900">{option.label}</div>
                        <div className="mt-1 text-xs text-secondary-600">{option.description}</div>
                      </div>
                      {visualStyle === option.value && <CheckCircle className="w-4 h-4 text-indigo-600" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">选择导入集数</h2>
              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                {availableEpisodes.map(episode => {
                  const story = getStoryForEpisode(episode);
                  const imported = importedEpisodeMap.get(episode);
                  const checked = selectedEpisodes.includes(episode);
                  return (
                    <button
                      key={episode}
                      type="button"
                      onClick={() => toggleEpisode(episode)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        checked ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-secondary-200 bg-white hover:bg-secondary-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-secondary-900">第{episode}集</div>
                          <div className="text-xs text-secondary-600 mt-1 line-clamp-2">
                            {imported?.title || story?.title || '已生成剧本正文'}
                          </div>
                          {imported && (
                            <div className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              外部导入
                            </div>
                          )}
                        </div>
                        {checked && <CheckCircle className="w-4 h-4 text-indigo-600 flex-shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => setSelectedEpisodes(availableEpisodes)} className="px-3 py-2 rounded-lg border border-secondary-200 bg-white hover:bg-secondary-50 text-sm text-secondary-700">全选</button>
                <button onClick={() => setSelectedEpisodes(availableEpisodes.slice(0, 1))} className="px-3 py-2 rounded-lg border border-secondary-200 bg-white hover:bg-secondary-50 text-sm text-secondary-700">只选首集</button>
              </div>
              <button
                onClick={generatePrompts}
                disabled={selectedEpisodes.length === 0 || isGenerating}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold"
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? '抓取生成中...' : '抓取本集资产'}
              </button>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">导入外部剧本</h2>
              <div className="space-y-3">
                <textarea
                  value={importedScriptText}
                  onChange={(event) => setImportedScriptText(event.target.value)}
                  rows={6}
                  placeholder="粘贴另一篇微短剧正文。支持txt、md、markdown、docx；按“第1集：标题”“第二集”自动拆分；如果没有集数标记，会作为单集导入。"
                  className="w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm font-medium text-secondary-700 hover:bg-secondary-50">
                    <Upload className="w-4 h-4" />
                    导入文件
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        event.currentTarget.value = '';
                        void importExternalScriptFile(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => parseImportedScript()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                  >
                    <Sparkles className="w-4 h-4" />
                    拆分导入
                  </button>
                </div>
                {importedEpisodes.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    已拆分 {importedEpisodes.length} 集：{importedEpisodes.map(item => `第${item.episode}集`).join('、')}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">补充生成</h2>
              <div className="space-y-3">
                <select
                  value={supplementEpisode}
                  onChange={(event) => setSupplementEpisode(event.target.value ? Number(event.target.value) : '')}
                  className="w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800"
                >
                  <option value="">选择集数</option>
                  {availableEpisodes.map(episode => (
                    <option key={episode} value={episode}>第{episode}集</option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSupplementType('character')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium ${supplementType === 'character' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-secondary-200 text-secondary-700'}`}
                  >
                    补人物
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplementType('scene')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium ${supplementType === 'scene' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-secondary-200 text-secondary-700'}`}
                  >
                    补场景
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplementType('prop')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium ${supplementType === 'prop' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-secondary-200 text-secondary-700'}`}
                  >
                    补道具
                  </button>
                </div>
                {supplementType === 'scene' && (
                  <label className="flex items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm text-secondary-700">
                    <input
                      type="checkbox"
                      checked={supplementNoPeople}
                      onChange={(event) => setSupplementNoPeople(event.target.checked)}
                      className="h-4 w-4 rounded border-secondary-300 text-indigo-600"
                    />
                    场景/倒叙不要出现人物
                  </label>
                )}
                <textarea
                  value={supplementNote}
                  onChange={(event) => setSupplementNote(event.target.value)}
                  rows={4}
                  placeholder={supplementType === 'character'
                    ? '例如：补一个第3集出现的老管家，沉稳、低调、灰色长袍。'
                    : supplementType === 'scene'
                    ? '例如：补第5集童年倒叙里的旧宅后院，只生成倒叙空镜，不要人物。'
                    : '例如：补第4集反复出现的玉佩，只生成独立道具图，不要人物。'}
                  className="w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800"
                />
                <button
                  onClick={generateSupplementalAsset}
                  disabled={isSupplementing || !supplementNote.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:bg-gray-300 disabled:text-gray-500"
                >
                  <Sparkles className={`w-4 h-4 ${isSupplementing ? 'animate-spin' : ''}`} />
                  {isSupplementing ? '补充生成中...' : '按补充设定生成'}
                </button>
              </div>
            </div>

            {summary && (
              <div className="card p-4 text-sm text-secondary-700">
                <div className="font-semibold text-secondary-900 mb-2">生成概要</div>
                {summary}
              </div>
            )}

            {episodeInventories.length > 0 && (
              <div className="card p-4 text-sm text-secondary-700">
                <div className="font-semibold text-secondary-900 mb-3">每集素材清单</div>
                <div className="space-y-3">
                  {episodeInventories.map(item => (
                    <div key={item.episodeNumber} className="rounded-lg border border-secondary-200 bg-secondary-50 p-3">
                      <div className="font-semibold text-secondary-900">第{item.episodeNumber}集</div>
                      <div className="mt-1 text-xs text-secondary-600">
                        人物 {item.characterAssetIds.length} · 场景 {item.sceneAssetIds.length} · 道具 {item.propAssetIds.length}
                      </div>
                      {item.missingImageNames.length > 0 && (
                        <div className="mt-2 text-xs text-amber-700">未导入图片：{item.missingImageNames.slice(0, 6).join('、')}{item.missingImageNames.length > 6 ? '等' : ''}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <section className="lg:col-span-9">
            {characters.length > 0 || scenes.length > 0 || props.length > 0 ? (
              <div className="space-y-8">
                {characters.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Users className="w-5 h-5 text-indigo-600" />
                      <h2 className="text-base font-semibold text-secondary-900">人物定妆照</h2>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {characters.map((item, index) => {
                  const id = getCharacterPromptId(item, index);
                  const checked = selectedIds.has(id);
                  const note = notes[id] || '';
                  const variants = getCharacterVariants(item);
                  return (
                    <article key={id} className={`card p-5 ${checked ? 'ring-2 ring-indigo-200' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold text-secondary-900">{item.name}</h3>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.matchedFromCharacterSetting ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {item.matchedFromCharacterSetting ? '人设匹配' : '剧情补全'}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-secondary-100 text-secondary-600 text-xs font-medium">
                              {item.appearanceLevel === 'core' ? '核心' : item.appearanceLevel === 'cameo' ? '龙套' : '配角'}
                            </span>
                          </div>
                          <p className="text-xs text-secondary-500 mt-1">
                            出现：第{(item.episodeNumbers || []).join('、')}集{item.aliases?.length ? ` · 别称：${item.aliases.join('、')}` : ''}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 text-xs text-secondary-600">
                          <input type="checkbox" checked={checked} onChange={() => toggleCharacter(id)} className="h-4 w-4 rounded border-secondary-300 text-indigo-600 focus:ring-indigo-500" />
                          保存
                        </label>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
                        <label
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const file = event.dataTransfer.files?.[0];
                            if (file) importImageForCharacter(index, file);
                          }}
                          className="aspect-[3/4] rounded-lg border-2 border-dashed border-secondary-300 bg-secondary-50 flex flex-col items-center justify-center text-center overflow-hidden cursor-pointer hover:bg-secondary-100"
                        >
                          {item.imageDataUrl ? (
                            <img src={item.imageDataUrl} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <>
                              <Upload className="w-8 h-8 text-secondary-400 mb-2" />
                              <span className="text-xs text-secondary-600">拖入图片或点击选择</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) importImageForCharacter(index, file);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>

                        <div className="space-y-3">
                          {item.imageFileName && (
                            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                              <FileImage className="w-4 h-4" />
                              已按人物名记录：{item.imageFileName}
                            </div>
                          )}
                          {item.roleBrief && <p className="text-sm text-secondary-700"><span className="font-semibold text-secondary-900">概况：</span>{item.roleBrief}</p>}
                          {item.plotBasis && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">剧情依据：</span>{item.plotBasis}</p>}
                          {item.characterSettingExcerpt && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">人设摘录：</span>{item.characterSettingExcerpt}</p>}
                        </div>
                      </div>

                      <div className="mt-4 rounded-lg border border-secondary-200 bg-white/80 p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary-700">
                          <ImageIcon className="w-4 h-4 text-indigo-600" />
                          即梦立绘提示词
                        </div>
                        <p className="text-sm leading-relaxed text-secondary-800 whitespace-pre-wrap">{item.prompt}</p>
                      </div>

                      <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-indigo-800">人物造型版本</div>
                          <span className="text-[11px] text-indigo-600">按集选择导出哪一版</span>
                        </div>
                        <div className="space-y-3">
                          {selectedEpisodes.filter(episode => (item.episodeNumbers || []).includes(episode)).map(episode => (
                            <div key={episode} className="flex items-center gap-2">
                              <span className="w-14 text-xs font-medium text-secondary-700">第{episode}集</span>
                              <select
                                value={item.activeVariantIdByEpisode?.[String(episode)] || getBaseVariantId(item)}
                                onChange={(event) => setCharacterVariantForEpisode(index, episode, event.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-secondary-800"
                              >
                                {variants.map(variant => (
                                  <option key={variant.id} value={variant.id}>{variant.name}</option>
                                ))}
                              </select>
                            </div>
                          ))}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {variants.map(variant => (
                              <label
                                key={variant.id}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const file = event.dataTransfer.files?.[0];
                                  if (file) importImageForCharacterVariant(index, variant.id, file);
                                }}
                                className="rounded-lg border border-indigo-100 bg-white p-2 text-xs text-secondary-700"
                              >
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className="font-semibold text-secondary-900">{variant.name}</span>
                                  <span className={variant.imageDataUrl ? 'text-emerald-600' : 'text-amber-600'}>
                                    {variant.imageDataUrl ? '有图' : '未导图'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {variant.imageDataUrl ? (
                                    <img src={variant.imageDataUrl} alt={variant.name} className="h-14 w-10 rounded object-cover" />
                                  ) : (
                                    <div className="flex h-14 w-10 items-center justify-center rounded bg-secondary-100">
                                      <Upload className="w-4 h-4 text-secondary-400" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="line-clamp-2 text-secondary-500">{variant.promptNote || variant.visualBrief || '基础定妆造型'}</div>
                                    <div className="mt-1 text-indigo-600">点击/拖入图片</div>
                                  </div>
                                </div>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) importImageForCharacterVariant(index, variant.id, file);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        <textarea
                          value={note}
                          onChange={(event) => setNotes(prev => ({ ...prev, [id]: event.target.value }))}
                          rows={3}
                          placeholder="给这个人物写备注，例如：衣服更朴素、眼神更疲惫、不要红色、保留大理寺腰牌、换成现代职场套装..."
                          className="w-full rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => revisePrompt(index, 'tune')}
                            disabled={!note.trim() || Boolean(busyKey)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
                          >
                            <RefreshCw className={`w-4 h-4 ${busyKey === `${id}-tune` ? 'animate-spin' : ''}`} />
                            按备注微调提示词
                          </button>
                          <button
                            onClick={() => revisePrompt(index, 'regenerate')}
                            disabled={!note.trim() || Boolean(busyKey)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
                          >
                            <Sparkles className={`w-4 h-4 ${busyKey === `${id}-regenerate` ? 'animate-spin' : ''}`} />
                            按备注重新生成
                          </button>
                          <button
                            onClick={() => createCharacterVariant(index)}
                            disabled={!note.trim() || Boolean(busyKey)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
                          >
                            <Sparkles className={`w-4 h-4 ${busyKey === `${id}-variant` ? 'animate-spin' : ''}`} />
                            按备注新增造型版本
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                    </div>
                  </div>
                )}

                {scenes.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <MapIcon className="w-5 h-5 text-sky-600" />
                      <h2 className="text-base font-semibold text-secondary-900">每集场景空镜</h2>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                      {scenes.map((item, index) => {
                        const id = getScenePromptId(item, index);
                        const checked = selectedSceneIds.has(id);
                        return (
                          <article key={id} className={`card p-5 ${checked ? 'ring-2 ring-sky-200' : ''}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-lg font-bold text-secondary-900">{item.name}</h3>
                                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-700 text-xs font-medium">第{item.episodeNumber}集</span>
                                  <span className="px-2 py-0.5 rounded bg-secondary-100 text-secondary-600 text-xs font-medium">
                                    {item.sceneType === 'flashback' ? '倒叙/回忆' : item.sceneType === 'transition' ? '转场' : item.sceneType === 'secondary' ? '辅助场景' : '主场景'}
                                  </span>
                                </div>
                                {item.sceneBrief && <p className="mt-2 text-sm text-secondary-700">{item.sceneBrief}</p>}
                              </div>
                              <label className="inline-flex items-center gap-2 text-xs text-secondary-600">
                                <input type="checkbox" checked={checked} onChange={() => toggleScene(id)} className="h-4 w-4 rounded border-secondary-300 text-sky-600 focus:ring-sky-500" />
                                保存
                              </label>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
                              <label
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const file = event.dataTransfer.files?.[0];
                                  if (file) importImageForScene(index, file);
                                }}
                                className="aspect-[4/3] rounded-lg border-2 border-dashed border-secondary-300 bg-secondary-50 flex flex-col items-center justify-center text-center overflow-hidden cursor-pointer hover:bg-secondary-100"
                              >
                                {item.imageDataUrl ? (
                                  <img src={item.imageDataUrl} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <>
                                    <Clapperboard className="w-8 h-8 text-secondary-400 mb-2" />
                                    <span className="text-xs text-secondary-600">拖入场景图或点击选择</span>
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) importImageForScene(index, file);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                              <div className="space-y-3">
                                {item.imageFileName && (
                                  <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                    <FileImage className="w-4 h-4" />
                                    已按场景名记录：{item.imageFileName}
                                  </div>
                                )}
                                {item.plotBasis && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">剧情依据：</span>{item.plotBasis}</p>}
                                {item.visualBrief && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">视觉依据：</span>{item.visualBrief}</p>}
                              </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-secondary-200 bg-white/80 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary-700">
                                <ImageIcon className="w-4 h-4 text-sky-600" />
                                场景空镜提示词
                              </div>
                              <p className="text-sm leading-relaxed text-secondary-800 whitespace-pre-wrap">{item.prompt}</p>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}

                {props.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Package className="w-5 h-5 text-amber-600" />
                      <h2 className="text-base font-semibold text-secondary-900">出场道具资产</h2>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                      {props.map((item, index) => {
                        const id = getPropPromptId(item, index);
                        const checked = selectedPropIds.has(id);
                        return (
                          <article key={id} className={`card p-5 ${checked ? 'ring-2 ring-amber-200' : ''}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-lg font-bold text-secondary-900">{item.name}</h3>
                                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium">第{(item.episodeNumbers || []).join('、')}集</span>
                                  <span className="px-2 py-0.5 rounded bg-secondary-100 text-secondary-600 text-xs font-medium">
                                    {item.reusable ? '可复用' : '单集道具'}
                                  </span>
                                </div>
                                {item.propBrief && <p className="mt-2 text-sm text-secondary-700">{item.propBrief}</p>}
                              </div>
                              <label className="inline-flex items-center gap-2 text-xs text-secondary-600">
                                <input type="checkbox" checked={checked} onChange={() => toggleProp(id)} className="h-4 w-4 rounded border-secondary-300 text-amber-600 focus:ring-amber-500" />
                                保存
                              </label>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
                              <label
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const file = event.dataTransfer.files?.[0];
                                  if (file) importImageForProp(index, file);
                                }}
                                className="aspect-square rounded-lg border-2 border-dashed border-secondary-300 bg-secondary-50 flex flex-col items-center justify-center text-center overflow-hidden cursor-pointer hover:bg-secondary-100"
                              >
                                {item.imageDataUrl ? (
                                  <img src={item.imageDataUrl} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <>
                                    <Package className="w-8 h-8 text-secondary-400 mb-2" />
                                    <span className="text-xs text-secondary-600">拖入道具图或点击选择</span>
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) importImageForProp(index, file);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                              <div className="space-y-3">
                                {item.imageFileName && (
                                  <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                    <FileImage className="w-4 h-4" />
                                    已按道具名记录：{item.imageFileName}
                                  </div>
                                )}
                                {item.plotBasis && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">剧情依据：</span>{item.plotBasis}</p>}
                                {item.visualBrief && <p className="text-sm text-secondary-600"><span className="font-semibold text-secondary-900">视觉依据：</span>{item.visualBrief}</p>}
                              </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-secondary-200 bg-white/80 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary-700">
                                <ImageIcon className="w-4 h-4 text-amber-600" />
                                道具提示词
                              </div>
                              <p className="text-sm leading-relaxed text-secondary-800 whitespace-pre-wrap">{item.prompt}</p>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-12 text-center">
                <Users className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-secondary-900">还没有人物、场景和道具提示词</h2>
                <p className="text-secondary-600 mt-2">左侧先选视觉模式和集数，然后抓取本集资产。</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
