// React import not needed with jsx: "react-jsx"
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { MiddleStory, storyCategories, getStoriesByCategory } from '../data/middleStories';

interface MiddleStorySelectorProps {
  selectedStories: MiddleStory[];
  onSelectionChange: (stories: MiddleStory[]) => void;
  maxSelection?: number;
}

export function MiddleStorySelector({
  selectedStories,
  onSelectionChange,
  maxSelection = 30
}: MiddleStorySelectorProps) {
  const [activeCategory, setActiveCategory] = useState(storyCategories[0]);

  const handleStoryToggle = (story: MiddleStory) => {
    const isSelected = selectedStories.some(s => s.id === story.id);

    if (isSelected) {
      // 取消选择
      onSelectionChange(selectedStories.filter(s => s.id !== story.id));
    } else {
      // 添加选择（检查数量限制）
      if (selectedStories.length >= maxSelection) {
        alert(`最多只能选择${maxSelection}个中故事`);
        return;
      }
      onSelectionChange([...selectedStories, story]);
    }
  };

  const currentStories = getStoriesByCategory(activeCategory);

  return (
    <div className="space-y-6">
      {/* 类别标签 */}
      <div className="flex flex-wrap gap-2">
        {storyCategories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeCategory === category
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* 选择统计 */}
      <div className="flex items-center justify-between text-sm text-secondary-600">
        <span>已选择: {selectedStories.length} / {maxSelection}</span>
        <span>建议选择: 25-30个</span>
      </div>

      {/* 故事列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {currentStories.map((story) => {
          const isSelected = selectedStories.some(s => s.id === story.id);

          return (
            <div
              key={story.id}
              className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                isSelected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-secondary-200 bg-white hover:border-secondary-300'
              }`}
              onClick={() => handleStoryToggle(story)}
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-medium text-secondary-900">
                  {story.title}
                </h4>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  isSelected ? 'bg-primary-600' : 'bg-secondary-200'
                }`}>
                  {isSelected ? (
                    <Check className="w-3 h-3 text-white" />
                  ) : (
                    <Plus className="w-3 h-3 text-secondary-600" />
                  )}
                </div>
              </div>
              <p className="text-sm text-secondary-600">
                {story.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* 已选择的故事摘要 */}
      {selectedStories.length > 0 && (
        <div className="card p-4">
          <h4 className="font-medium text-secondary-900 mb-3">
            已选择的中故事 ({selectedStories.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {selectedStories.map((story) => (
              <div
                key={story.id}
                className="flex items-center space-x-2 bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm"
              >
                <span>{story.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStoryToggle(story);
                  }}
                  className="hover:bg-primary-200 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}