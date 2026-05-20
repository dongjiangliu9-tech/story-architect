import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle, Clapperboard, Save, Sparkles } from 'lucide-react';
import { AssetVisualStyle, SeedanceAssetRef, SeedancePromptSegment, blueprintApi } from '../services/api';
import { SavedMicroStory, sortSavedMicroStoriesForChapters, useWorldSettings } from '../contexts/WorldSettingsContext';

interface SeeDancePromptsPageProps {
  onBack: () => void;
}

const SEEDANCE_PROMPT_EXAMPLE = `2D动漫风格，无背景音乐，电影级光影，画面细节丰富，无字幕，人物身上没有污渍，天气晴朗，白天，场景是一个山顶悬崖边，周围的满是盛开着鲜艳白色桃花的桃树，桃花慢慢飘落，地面上小草茂盛，春暖花开，微风吹拂，画面唯美，@图一的男人身后背着@图五的剑鞘
第一个镜头，空镜，特写，微风吹拂着白色的桃花，桃花花瓣缓缓飘落，画面唯美，
第二个镜头，近景，@图一的男人趴在地上，昏迷着，@图四的剑在他右手旁，背后背着@图五的剑鞘，他挣扎着缓缓睁开眼，他右手抓住@图四的剑的剑柄，然后挣扎着慢慢站起身，
第三个镜头，前景画面左侧近景是@图一男人的背影，@图一的男人把手里的@图三收进背后的@图五剑鞘里，变成@图六的背影，镜头微微向右移动，露出景深处在悬崖边的@图二老人的背影。`;

function extractEpisodeNumber(story: SavedMicroStory | undefined, fallback: number): number {
  const text = `${story?.title || ''}\n${story?.content || ''}`;
  const match = text.match(/第\s*(\d{1,4})\s*集/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toChineseImageLabel(index: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (index <= 10) return `图${index === 10 ? '十' : digits[index]}`;
  if (index < 20) return `图十${digits[index - 10]}`;
  const tens = Math.floor(index / 10);
  const ones = index % 10;
  return `图${digits[tens]}十${ones ? digits[ones] : ''}`;
}

function toSeedanceImageLabel(index: number): string {
  return `@${toChineseImageLabel(index)}`;
}

function getSceneEpisodes(scene: { episodeNumber?: number; episodeNumbers?: number[] }): number[] {
  return [...new Set([...(scene.episodeNumbers || []), scene.episodeNumber].map(Number).filter(value => Number.isFinite(value) && value > 0))];
}

function getBaseVariantId(item: any): string {
  return `${item.id || item.name || 'character'}__base`;
}

function getActiveCharacterVariant(item: any, episode: number) {
  const baseVariant = {
    id: getBaseVariantId(item),
    name: '默认造型',
    prompt: item.prompt,
    promptNote: item.promptNote,
    visualBrief: item.visualBrief,
  };
  const variants = [baseVariant, ...(item.variants || [])];
  const activeId = item.activeVariantIdByEpisode?.[String(episode)];
  return variants.find(variant => variant.id === activeId) || variants[0];
}

export function SeeDancePromptsPage({ onBack }: SeeDancePromptsPageProps) {
  const { currentProject, updateProject } = useWorldSettings();
  const [selectedEpisode, setSelectedEpisode] = useState<number | ''>('');
  const [segments, setSegments] = useState<SeedancePromptSegment[]>([]);
  const [summary, setSummary] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generatedChapters = currentProject?.generatedChapters || {};
  const latestPack = currentProject?.characterPromptPacks?.[0];
  const visualStyle: AssetVisualStyle = latestPack?.visualStyle || 'live_action';

  const storyEntries = useMemo(() => {
    const stories = sortSavedMicroStoriesForChapters(currentProject?.savedMicroStories || []);
    return stories.map((story, index) => ({
      story,
      episode: extractEpisodeNumber(story, index + 1),
    }));
  }, [currentProject?.savedMicroStories]);

  const availableEpisodes = useMemo(() => (
    Object.keys(generatedChapters)
      .map(Number)
      .filter(episode => Number.isFinite(episode) && generatedChapters[episode]?.trim())
      .sort((a, b) => a - b)
  ), [generatedChapters]);

  useEffect(() => {
    if (availableEpisodes.length > 0 && selectedEpisode === '') {
      setSelectedEpisode(availableEpisodes[0]);
    }
  }, [availableEpisodes, selectedEpisode]);

  useEffect(() => {
    const episode = Number(selectedEpisode);
    if (!Number.isFinite(episode)) return;
    const savedPack = (currentProject?.seedancePromptPacks || [])
      .filter(pack => pack.episodeNumber === episode)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    if (savedPack) {
      setSegments(savedPack.segments || []);
      setSummary(savedPack.summary || '');
    } else {
      setSegments([]);
      setSummary('');
    }
  }, [currentProject?.seedancePromptPacks, selectedEpisode]);

  const getStoryForEpisode = (episode: number) => storyEntries.find(item => item.episode === episode)?.story;

  const assetRefs = useMemo<SeedanceAssetRef[]>(() => {
    const episode = Number(selectedEpisode);
    if (!Number.isFinite(episode) || !latestPack) return [];
    let imageIndex = 1;
    const refs: SeedanceAssetRef[] = [];
    (latestPack.characters || [])
      .filter(item => (item.episodeNumbers || []).includes(episode))
      .forEach(item => {
        const variant = getActiveCharacterVariant(item, episode);
        refs.push({
          label: toSeedanceImageLabel(imageIndex++),
          assetType: 'character',
          name: `${item.name}（${variant.name}）`,
          brief: item.roleBrief || variant.visualBrief || item.visualBrief,
          prompt: variant.prompt || item.prompt,
        });
      });
    (latestPack.scenes || [])
      .filter(item => getSceneEpisodes(item).includes(episode))
      .forEach(item => refs.push({
        label: toSeedanceImageLabel(imageIndex++),
        assetType: 'scene',
        name: item.name,
        brief: item.sceneBrief || item.visualBrief,
        prompt: item.prompt,
      }));
    (latestPack.props || [])
      .filter(item => (item.episodeNumbers || []).includes(episode))
      .forEach(item => refs.push({
        label: toSeedanceImageLabel(imageIndex++),
        assetType: 'prop',
        name: item.name,
        brief: item.propBrief || item.visualBrief,
        prompt: item.prompt,
      }));
    return refs;
  }, [latestPack, selectedEpisode]);

  const generatePrompts = async () => {
    if (!currentProject) return;
    const episode = Number(selectedEpisode);
    if (!Number.isFinite(episode) || !generatedChapters[episode]?.trim()) {
      alert('请先选择一集已生成正文');
      return;
    }
    setIsGenerating(true);
    try {
      const story = getStoryForEpisode(episode);
      const response = await blueprintApi.generateSeedancePrompts({
        visualStyle,
        assets: assetRefs,
        targetSegmentCount: 8,
        shotsPerSegment: 5,
        promptExample: SEEDANCE_PROMPT_EXAMPLE,
        worldSetting: currentProject.worldSetting,
        characters: currentProject.characters,
        detailedOutline: currentProject.detailedOutline,
        episode: {
          episode,
          title: story?.title,
          outline: story?.content,
          content: generatedChapters[episode],
        },
      });
      setSegments(response.data.segments || []);
      setSummary(response.data.summary || '');
    } catch (error) {
      console.error('生成SeeDance提示词失败:', error);
      alert((error as any)?.response?.data?.message || (error as any)?.message || 'SeeDance提示词生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const savePack = () => {
    if (!currentProject) return;
    const episode = Number(selectedEpisode);
    if (!segments.length || !Number.isFinite(episode)) {
      alert('请先生成SeeDance提示词');
      return;
    }
    const pack = {
      id: `seedance_prompt_${Date.now()}`,
      createdAt: new Date().toISOString(),
      episodeNumber: episode,
      visualStyle,
      assetLabels: assetRefs.map((item, index) => ({
        label: item.label,
        assetType: item.assetType,
        name: item.name,
        assetId: `${item.assetType}_${index}`,
      })),
      segments,
      summary,
    };
    updateProject(currentProject.id, {
      seedancePromptPacks: [pack, ...(currentProject.seedancePromptPacks || [])].slice(0, 30),
    });
    alert(`已保存第${episode}集 SeeDance 提示词。`);
  };

  if (!currentProject || currentProject.detailedOutlineMode !== 'microdrama') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100 flex items-center justify-center">
        <div className="card p-8 text-center">
          <Clapperboard className="w-14 h-14 text-secondary-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-secondary-900">未找到微短剧项目</h2>
          <button onClick={onBack} className="mt-5 btn btn-primary">返回资产页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-primary-50 to-secondary-100">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-sm border-b border-secondary-200">
        <div className="w-full px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-secondary-700" title="返回资产页">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-secondary-900">SeeDance提示词细化</h1>
              <p className="text-xs text-secondary-600">按本集正文拆成6-10段，每段5-7个细镜头，强化人物关系、专业调度和口语化信息台词。</p>
            </div>
          </div>
          <button
            onClick={savePack}
            disabled={segments.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-medium"
          >
            <Save className="w-4 h-4" />
            保存SeeDance提示词
          </button>
        </div>
      </header>

      <main className="w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-3 space-y-5">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">选择集数</h2>
              <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                {availableEpisodes.map(episode => {
                  const checked = selectedEpisode === episode;
                  const story = getStoryForEpisode(episode);
                  return (
                    <button
                      key={episode}
                      type="button"
                      onClick={() => setSelectedEpisode(episode)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${checked ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100' : 'border-secondary-200 bg-white hover:bg-secondary-50'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-secondary-900">第{episode}集</div>
                          <div className="text-xs text-secondary-600 mt-1 line-clamp-2">{story?.title || '已生成剧本正文'}</div>
                        </div>
                        {checked && <CheckCircle className="w-4 h-4 text-violet-600" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={generatePrompts}
                disabled={!selectedEpisode || isGenerating}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500"
              >
                <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? '拆解生成中...' : '生成SeeDance分段'}
              </button>
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-secondary-900 mb-3">本集@图号</h2>
              {assetRefs.length > 0 ? (
                <div className="space-y-2">
                  {assetRefs.map(item => (
                    <div key={`${item.label}-${item.name}`} className="rounded-lg border border-secondary-200 bg-secondary-50 p-3">
                      <div className="text-sm font-semibold text-secondary-900">{item.label} · {item.name}</div>
                      <div className="text-xs text-secondary-600 mt-1">
                        {item.assetType === 'character' ? '人物' : item.assetType === 'scene' ? '场景' : '道具'}{item.brief ? ` · ${item.brief}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary-600">这一集还没有保存的人物、场景或道具资产。</p>
              )}
            </div>

            {summary && (
              <div className="card p-4 text-sm text-secondary-700">
                <div className="font-semibold text-secondary-900 mb-2">拆解概要</div>
                {summary}
              </div>
            )}
          </aside>

          <section className="lg:col-span-9">
            {segments.length > 0 ? (
              <div className="space-y-5">
                {segments.map((segment, index) => (
                  <article key={segment.index} className="card p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-secondary-900">第{segment.index || index + 1}段 · {segment.title}</h2>
                        <p className="mt-1 text-xs text-secondary-500">
                          {segment.scriptRange || '按正文顺序拆解'}{segment.assetRefs?.length ? ` · 引用：${segment.assetRefs.join('、')}` : ''}
                        </p>
                      </div>
                    </div>
                    <textarea
                      value={segment.prompt}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSegments(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: value } : item));
                      }}
                      rows={12}
                      className="w-full rounded-lg border border-secondary-200 bg-white px-4 py-3 text-sm leading-relaxed text-secondary-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="card p-12 text-center">
                <Clapperboard className="w-16 h-16 text-secondary-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-secondary-900">还没有SeeDance分段提示词</h2>
                <p className="text-secondary-600 mt-2">先选择集数，确认本集@图号，再生成6-10段视频提示词。</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
