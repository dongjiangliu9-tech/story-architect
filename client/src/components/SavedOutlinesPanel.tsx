// React import not needed with jsx: "react-jsx"
import { Bookmark, Download, Trash2, Calendar, FileText } from 'lucide-react';
import { useSavedOutlines } from '../contexts/SavedOutlinesContext';
import { OutlineData } from '../types';

interface SavedOutlinesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadOutline: (outline: OutlineData) => void;
}

export function SavedOutlinesPanel({ isOpen, onClose, onLoadOutline }: SavedOutlinesPanelProps) {
  const { savedOutlines, removeSavedOutline, exportAllSaved } = useSavedOutlines();

  if (!isOpen) return null;

  const handleLoadOutline = (outline: OutlineData) => {
    onLoadOutline(outline);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
        {/* 头部 */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Bookmark className="w-6 h-6" />
              <div>
                <h2 className="text-xl font-bold">保存的故事架构</h2>
                <p className="text-primary-100 text-sm">
                  已保存 {savedOutlines.length} 个故事架构
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {savedOutlines.length > 0 && (
                <button
                  onClick={exportAllSaved}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>导出全部</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center bg-primary-500 hover:bg-primary-400 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {savedOutlines.length === 0 ? (
            <div className="text-center py-12">
              <Bookmark className="w-16 h-16 text-secondary-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 mb-2">
                还没有保存的故事架构
              </h3>
              <p className="text-secondary-600">
                在生成结果页面点击"保存"按钮来保存你喜欢的故事架构
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {savedOutlines.map((outline) => (
                <div
                  key={outline.id}
                  className="border border-secondary-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-secondary-900 mb-1">
                        {outline.title}
                      </h3>
                      <p className="text-sm text-secondary-600 line-clamp-2">
                        {outline.logline}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <button
                        onClick={() => handleLoadOutline(outline)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700 transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                        <span>查看</span>
                      </button>
                      <button
                        onClick={() => removeSavedOutline(outline.id)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>删除</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-secondary-500">
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3" />
                      <span>
                        保存于 {outline.savedAt ? new Date(outline.savedAt).toLocaleDateString('zh-CN') : '未知时间'}
                      </span>
                    </div>
                    <span>架构 #{outline.id}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}