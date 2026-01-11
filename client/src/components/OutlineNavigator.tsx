// React import not needed with jsx: "react-jsx"
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface OutlineNavigatorProps {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function OutlineNavigator({ currentIndex, total, onPrev, onNext }: OutlineNavigatorProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onPrev}
        className="flex items-center space-x-2 btn btn-secondary"
        disabled={total <= 1}
      >
        <ChevronLeft className="w-4 h-4" />
        <span>上一个</span>
      </button>

      <div className="flex items-center space-x-3">
        <span className="text-sm text-secondary-600">灵感架构</span>
        <div className="flex space-x-1">
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentIndex ? 'bg-primary-600' : 'bg-secondary-300'
              }`}
            />
          ))}
        </div>
        <span className="text-sm font-medium text-primary-600">
          {currentIndex + 1} / {total}
        </span>
      </div>

      <button
        onClick={onNext}
        className="flex items-center space-x-2 btn btn-secondary"
        disabled={total <= 1}
      >
        <span>下一个</span>
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}