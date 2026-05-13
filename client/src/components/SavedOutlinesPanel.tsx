// React import not needed with jsx: "react-jsx"
import { useState } from 'react';
import { Bookmark, Download, Trash2, Calendar, FileText, RefreshCw, UploadCloud } from 'lucide-react';
import { useSavedOutlines } from '../contexts/SavedOutlinesContext';
import { OutlineData } from '../types';

interface SavedOutlinesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadOutline: (outline: OutlineData) => void;
}

export function SavedOutlinesPanel({ isOpen, onClose, onLoadOutline }: SavedOutlinesPanelProps) {
  const { savedOutlines, removeSavedOutline, exportAllSaved, pullCloudOutlines, syncSavedOutlinesToCloud } = useSavedOutlines();
  const [isPullingCloud, setIsPullingCloud] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  if (!isOpen) return null;

  const handleLoadOutline = (outline: OutlineData) => {
    onLoadOutline(outline);
    onClose();
  };

  const handlePullCloudOutlines = async () => {
    setIsPullingCloud(true);
    try {
      const result = await pullCloudOutlines(true);
      alert(`云端灵感架构已拉取：当前共有 ${result.total} 条。`);
    } catch (error) {
      console.error('拉取云端灵感架构失败:', error);
      alert('拉取云端灵感架构失败，请确认激活码和网络后重试。');
    } finally {
      setIsPullingCloud(false);
    }
  };

  const handleSyncCloudOutlines = async () => {
    setIsSyncingCloud(true);
    try {
      const ok = await syncSavedOutlinesToCloud(true);
      alert(ok ? '已同步到云端。' : '未完成同步，请确认激活码后重试。');
    } catch (error) {
      console.error('同步云端灵感架构失败:', error);
      alert('同步云端灵感架构失败，请稍后重试。');
    } finally {
      setIsSyncingCloud(false);
    }
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
              <button
                onClick={handlePullCloudOutlines}
                disabled={isPullingCloud}
                className="flex items-center space-x-2 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                title="按当前激活码从云端拉回保存的灵感架构"
              >
                <RefreshCw className={`w-4 h-4 ${isPullingCloud ? 'animate-spin' : ''}`} />
                <span>{isPullingCloud ? '拉取中' : '拉取云端'}</span>
              </button>
              {savedOutlines.length > 0 && (
                <button
                  onClick={handleSyncCloudOutlines}
                  disabled={isSyncingCloud}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 disabled:bg-primary-400 rounded-lg text-sm font-medium transition-colors"
                  title="把当前浏览器保存的灵感架构同步到云端"
                >
                  <UploadCloud className={`w-4 h-4 ${isSyncingCloud ? 'animate-pulse' : ''}`} />
                  <span>{isSyncingCloud ? '同步中' : '同步云端'}</span>
                </button>
              )}
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
