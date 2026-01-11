import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { NovelCategory } from '../types';
import { categories } from '../data/novelCategories';

interface CategorySelectorProps {
  selectedCategory: NovelCategory | null;
  onSelectCategory: (category: NovelCategory | null) => void;
}

export function CategorySelector({ selectedCategory, onSelectCategory }: CategorySelectorProps) {
  const [gender, setGender] = useState<'male' | 'female'>('male');

  const currentCategories = categories[gender];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-secondary-700">
        网文频道
      </label>

      {/* 性别选择 */}
      <div className="flex bg-secondary-100 rounded-lg p-1">
        <button
          onClick={() => {
            setGender('male');
            onSelectCategory(null);
          }}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            gender === 'male'
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-secondary-600 hover:text-secondary-900'
          }`}
        >
          男频
        </button>
        <button
          onClick={() => {
            setGender('female');
            onSelectCategory(null);
          }}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            gender === 'female'
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-secondary-600 hover:text-secondary-900'
          }`}
        >
          女频
        </button>
      </div>

      {/* 分类选择 */}
      <div className="grid grid-cols-2 gap-2">
        {currentCategories.map((category) => (
          <button
            key={category.id}
            onClick={() => onSelectCategory(category)}
            className={`p-3 rounded-lg border-2 text-left transition-all hover:shadow-md ${
              selectedCategory?.id === category.id
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-secondary-200 bg-white hover:border-secondary-300'
            }`}
          >
            <div className="flex items-center space-x-2 mb-1">
              <BookOpen className="w-4 h-4" />
              <span className="font-medium text-sm">{category.name}</span>
            </div>
            <p className="text-xs text-secondary-600 leading-tight">
              {category.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}