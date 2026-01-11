// React import not needed with jsx: "react-jsx"
import { Heart } from 'lucide-react';

interface ThemeInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function ThemeInput({ value, onChange }: ThemeInputProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-secondary-700">
        核心主题
      </label>

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Heart className="w-4 h-4 text-secondary-400" />
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例如：复仇与救赎、爱与牺牲、成长与蜕变..."
          className="w-full pl-10 pr-3 py-3 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none transition-colors"
          rows={3}
        />
      </div>

      <p className="text-xs text-secondary-500">
        描述你想要表达的核心情感或哲学命题
      </p>
    </div>
  );
}