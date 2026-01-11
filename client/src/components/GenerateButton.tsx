// React import not needed with jsx: "react-jsx"
import { Sparkles, Loader2 } from 'lucide-react';

interface GenerateButtonProps {
  onClick: () => void;
  disabled: boolean;
  isLoading: boolean;
}

export function GenerateButton({ onClick, disabled, isLoading }: GenerateButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full btn btn-primary py-3 text-base font-semibold flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        isLoading ? 'animate-pulse' : ''
      }`}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>生成中...</span>
        </>
      ) : (
        <>
          <Sparkles className="w-5 h-5" />
          <span>生成故事架构</span>
        </>
      )}
    </button>
  );
}