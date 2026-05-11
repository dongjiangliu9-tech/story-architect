import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Sparkles, Tags, X } from 'lucide-react';
import { NovelCategory, NovelStyle } from '../types';
import {
  CreativeChannel,
  CreativeTag,
  CreativeTagGroup,
  creativeChannels,
  creativeGroupLabels,
  creativeTagsByChannel,
  getCreativeTagById,
} from '../data/creativeTags';

interface CreativeConfigSelectorProps {
  selectedCategory: NovelCategory | null;
  selectedStyles: NovelStyle[];
  onSelectCategory: (category: NovelCategory | null) => void;
  onChangeSelectedStyles: (styles: NovelStyle[]) => void;
}

const groupOrder: CreativeTagGroup[] = ['popular', 'theme', 'role', 'plot'];
const channelOrder: CreativeChannel[] = ['male', 'female', 'tiktok'];

function resolveChannel(category: NovelCategory | null): CreativeChannel {
  if (category?.id === 'tiktok') return 'tiktok';
  return category?.id === 'female' ? 'female' : 'male';
}

export function CreativeConfigSelector({
  selectedCategory,
  selectedStyles,
  onSelectCategory,
  onChangeSelectedStyles,
}: CreativeConfigSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [channel, setChannel] = useState<CreativeChannel>(() => resolveChannel(selectedCategory));
  const [activeGroup, setActiveGroup] = useState<CreativeTagGroup>('theme');

  useEffect(() => {
    if (!selectedCategory) {
      onSelectCategory(creativeChannels[channel]);
    }
  }, [channel, onSelectCategory, selectedCategory]);

  const selectedIds = useMemo(
    () => new Set(selectedStyles.map(style => style.id)),
    [selectedStyles],
  );

  const groupedSelected = useMemo(() => {
    return groupOrder.map(group => ({
      group,
      tags: selectedStyles
        .map(style => getCreativeTagById(style.id))
        .filter((tag): tag is CreativeTag => Boolean(tag))
        .filter(tag => tag.group === group),
    }));
  }, [selectedStyles]);

  const activeTags = creativeTagsByChannel[channel][activeGroup];

  const changeChannel = (nextChannel: CreativeChannel) => {
    setChannel(nextChannel);
    onSelectCategory(creativeChannels[nextChannel]);
    onChangeSelectedStyles([]);
    setActiveGroup('theme');
  };

  const toggleTag = (tag: CreativeTag) => {
    const next = selectedIds.has(tag.id)
      ? selectedStyles.filter(style => style.id !== tag.id)
      : [...selectedStyles, tag];
    onChangeSelectedStyles(next);
  };

  const clearAll = () => {
    onChangeSelectedStyles([]);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-secondary-700">
        创作标签
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full border border-secondary-200 bg-white rounded-lg p-4 text-left hover:border-primary-300 hover:shadow-md transition-all"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-secondary-900 font-semibold">
              <Tags className="w-4 h-4 text-primary-600" />
              <span>{creativeChannels[channel].name}</span>
              <span className="text-xs font-medium text-secondary-500">
                已选 {selectedStyles.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedStyles.length > 0 ? (
                selectedStyles.slice(0, 9).map(style => (
                  <span
                    key={style.id}
                    className="px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium"
                  >
                    {style.name}
                  </span>
                ))
              ) : (
                <span className="text-sm text-secondary-500">选择热门、主题、角色、情节标签</span>
              )}
              {selectedStyles.length > 9 && (
                <span className="px-2.5 py-1 rounded-md bg-secondary-100 text-secondary-600 text-xs font-medium">
                  +{selectedStyles.length - 9}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-secondary-400 flex-shrink-0" />
        </div>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-6xl max-h-[88vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-secondary-900">创作配置</h3>
                  <p className="text-xs text-secondary-500">{creativeChannels[channel].name} · {selectedStyles.length} 个标签</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-9 h-9 rounded-lg hover:bg-secondary-100 text-secondary-500 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pt-4 border-b border-secondary-100 bg-white">
              <div className="flex gap-2 overflow-x-auto pb-4">
                {channelOrder.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeChannel(option)}
                    className={`px-5 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                      channel === option
                        ? 'bg-secondary-900 text-white shadow-sm'
                        : 'bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
                    }`}
                  >
                    {creativeChannels[option].name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col md:flex-row min-h-0">
              <aside className="md:w-44 border-b md:border-b-0 md:border-r border-secondary-100 bg-secondary-50 p-4">
                <div className="grid grid-cols-4 md:grid-cols-1 gap-2">
                  {groupOrder.map(group => {
                    const count = groupedSelected.find(item => item.group === group)?.tags.length || 0;
                    return (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setActiveGroup(group)}
                        className={`px-3 py-2 rounded-lg text-sm font-semibold text-left transition-colors ${
                          activeGroup === group
                            ? 'bg-primary-600 text-white'
                            : 'bg-white text-secondary-700 hover:bg-primary-50'
                        }`}
                      >
                        <span>{creativeGroupLabels[group]}</span>
                        {count > 0 && <span className="ml-2 text-xs opacity-80">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </aside>

              <main className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {activeTags.map(tag => {
                    const isSelected = selectedIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`h-12 rounded-lg px-3 text-sm font-medium transition-all flex items-center justify-center gap-2 border ${
                          isSelected
                            ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                            : 'bg-secondary-50 border-transparent text-secondary-900 hover:bg-white hover:border-primary-200'
                        }`}
                      >
                        {isSelected && <Check className="w-4 h-4" />}
                        <span className="truncate">{tag.name}</span>
                      </button>
                    );
                  })}
                </div>
              </main>
            </div>

            <div className="border-t border-secondary-100 px-6 py-4 bg-white">
              <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2 min-h-8">
                  {selectedStyles.length > 0 ? selectedStyles.map(style => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => onChangeSelectedStyles(selectedStyles.filter(item => item.id !== style.id))}
                      className="px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100"
                    >
                      {style.name} ×
                    </button>
                  )) : (
                    <span className="text-sm text-secondary-500">未选择标签</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={clearAll}
                    className="px-4 py-2 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-secondary-700 text-sm font-semibold"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-5 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold"
                  >
                    完成
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
