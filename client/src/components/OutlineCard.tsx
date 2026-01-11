// React import not needed with jsx: "react-jsx"
import { BookOpen, Target, Users, Globe, Heart, Sparkles, Bookmark, Download, Check } from 'lucide-react';
import { OutlineData } from '../types';
import { useSavedOutlines } from '../contexts/SavedOutlinesContext';
import { useState, useEffect } from 'react';

interface OutlineCardProps {
  outline: OutlineData;
  className?: string;
}

export function OutlineCard({ outline, className = '' }: OutlineCardProps) {
  const { saveOutline, isOutlineSaved, exportOutline } = useSavedOutlines();
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);

  // 初始化本地保存状态
  useEffect(() => {
    setLocalSaved(isOutlineSaved(outline));
  }, [isOutlineSaved, outline]);

  const handleSave = () => {
    saveOutline(outline);
    setLocalSaved(true);
    setShowSaveConfirm(true);
    setTimeout(() => setShowSaveConfirm(false), 2000);
  };

  const handleExport = () => {
    exportOutline(outline);
  };
  const sections = [
    {
      icon: Target,
      title: '核心概念',
      content: outline.logline,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      icon: Users,
      title: '人物关系',
      content: outline.characters,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      icon: Globe,
      title: '世界观设定',
      content: outline.world,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      icon: Sparkles,
      title: '主要冲突',
      content: outline.hook,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      icon: Heart,
      title: '金手指设定',
      content: outline.themes,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className={`card overflow-hidden ${className}`}>
      {/* 标题区域 */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
        <div className="flex items-center space-x-3 mb-2">
          <BookOpen className="w-6 h-6" />
          <h2 className="text-2xl font-bold">{outline.title}</h2>
        </div>
        <p className="text-primary-100 text-sm">
          由 Gemini 3 Pro 生成的故事架构
        </p>
      </div>

      {/* 内容区域 */}
      <div className="p-6 space-y-6">
        {sections.map((section, index) => (
          <div
            key={index}
            className={`rounded-lg p-4 ${section.bgColor} border-l-4 ${
              section.color.includes('blue') ? 'border-blue-500' :
              section.color.includes('purple') ? 'border-purple-500' :
              section.color.includes('green') ? 'border-green-500' :
              section.color.includes('orange') ? 'border-orange-500' :
              'border-red-500'
            } animate-slide-in`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-start space-x-3">
              <section.icon className={`w-5 h-5 mt-0.5 ${section.color}`} />
              <div className="flex-1">
                <h3 className={`font-semibold mb-2 ${section.color}`}>
                  {section.title}
                </h3>
                <div className="text-secondary-700 leading-relaxed whitespace-pre-line text-sm">
                  {section.content}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 底部操作区域 */}
      <div className="bg-secondary-50 px-6 py-4 border-t border-secondary-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-secondary-600">
            AI 生成的故事架构 #{outline.id}
          </span>

          <div className="flex items-center space-x-3">
            {/* 保存按钮 */}
            <button
              onClick={handleSave}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                showSaveConfirm
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : localSaved
                  ? 'bg-primary-100 text-primary-700 border border-primary-200'
                  : 'bg-white text-secondary-700 border border-secondary-200 hover:bg-secondary-50'
              }`}
              disabled={showSaveConfirm}
            >
              {showSaveConfirm ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>已保存</span>
                </>
              ) : localSaved ? (
                <>
                  <Bookmark className="w-4 h-4 fill-current" />
                  <span>已保存</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-4 h-4" />
                  <span>保存</span>
                </>
              )}
            </button>

            {/* 导出按钮 */}
            <button
              onClick={handleExport}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium bg-white text-secondary-700 border border-secondary-200 hover:bg-secondary-50 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>导出</span>
            </button>

            {/* 创意标签 */}
            <div className="flex items-center space-x-1 text-secondary-600">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm">创意无限</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}