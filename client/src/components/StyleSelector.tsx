// React import not needed with jsx: "react-jsx"
import { Palette } from 'lucide-react';
import { NovelStyle } from '../types';
import { novelStyles } from '../data/novelCategories';

interface StyleSelectorProps {
  selectedStyle: NovelStyle | null;
  onSelectStyle: (style: NovelStyle) => void;
}

export function StyleSelector({ selectedStyle, onSelectStyle }: StyleSelectorProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-secondary-700">
        写作风格
      </label>

      <div className="grid grid-cols-2 gap-2">
        {novelStyles.map((style) => (
          <button
            key={style.id}
            onClick={() => onSelectStyle(style)}
            className={`p-3 rounded-lg border-2 text-left transition-all hover:shadow-md ${
              selectedStyle?.id === style.id
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-secondary-200 bg-white hover:border-secondary-300'
            }`}
          >
            <div className="flex items-center space-x-2 mb-1">
              <Palette className="w-4 h-4" />
              <span className="font-medium text-sm">{style.name}</span>
            </div>
            <p className="text-xs text-secondary-600 leading-tight">
              {style.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}