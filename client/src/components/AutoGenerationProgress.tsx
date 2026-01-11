import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';

export interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number; // 0-100
  message?: string;
}

interface AutoGenerationProgressProps {
  steps: ProgressStep[];
  isVisible: boolean;
  onCancel: () => void;
  currentStepMessage?: string;
}

export function AutoGenerationProgress({
  steps,
  isVisible,
  onCancel,
  currentStepMessage
}: AutoGenerationProgressProps) {
  if (!isVisible) return null;

  const getStepIcon = (status: ProgressStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepColor = (status: ProgressStep['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-700';
      case 'running':
        return 'text-blue-700';
      case 'error':
        return 'text-red-700';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div>
                <h2 className="text-xl font-bold">一键自动生成</h2>
                <p className="text-primary-100 text-sm">
                  AI正在为您自动生成完整的小说内容
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="w-8 h-8 flex items-center justify-center bg-primary-500 hover:bg-primary-400 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Progress Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Current Step Message */}
          {currentStepMessage && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start space-x-2">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900">正在执行：</p>
                  <p className="text-sm text-blue-700">{currentStepMessage}</p>
                </div>
              </div>
            </div>
          )}

          {/* Progress Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-start space-x-4">
                <div className="flex-shrink-0 mt-1">
                  {getStepIcon(step.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className={`text-sm font-medium ${getStepColor(step.status)}`}>
                      {index + 1}. {step.label}
                    </h3>
                    {step.progress !== undefined && step.status === 'running' && (
                      <span className="text-xs text-gray-500">{step.progress}%</span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {step.progress !== undefined && (
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          step.status === 'completed'
                            ? 'bg-green-500'
                            : step.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-blue-500'
                        }`}
                        style={{ width: `${step.progress}%` }}
                      />
                    </div>
                  )}

                  {/* Step Message */}
                  {step.message && (
                    <p className={`text-xs ${getStepColor(step.status)}`}>
                      {step.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Estimated Time */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600">
              <strong>预计总耗时：</strong>15-30分钟（根据网络状况和AI响应速度）
            </p>
            <p className="text-xs text-gray-500 mt-1">
              过程中请勿关闭页面，AI会自动完成所有步骤
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}