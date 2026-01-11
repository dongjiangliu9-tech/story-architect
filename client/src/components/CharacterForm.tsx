// React import not needed with jsx: "react-jsx"
import { useState } from 'react';
import { Save, Edit2, User } from 'lucide-react';

export interface Character {
  id: string;
  name: string;
  role: 'protagonist' | 'heroine' | 'companion' | 'antagonist' | 'supporting';
  age: number;
  background: string;
  personality: string;
  abilities: string;
  relationships: string;
  currentStatus: string;
  development: string[]; // 成长记录
}

interface CharacterFormProps {
  character: Character;
  onSave: (character: Character) => void;
  onCancel?: () => void;
}

export function CharacterForm({ character, onSave, onCancel }: CharacterFormProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Character>(character);

  const handleSave = () => {
    onSave(formData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData(character);
    setIsEditing(false);
    onCancel?.();
  };

  const roleLabels = {
    protagonist: '主角',
    heroine: '女主',
    companion: '主角团',
    antagonist: '反派',
    supporting: '配角'
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-primary-100 rounded-lg">
            <User className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-semibold text-secondary-900">{formData.name}</h3>
            <span className="text-sm text-secondary-600">{roleLabels[formData.role]}</span>
          </div>
        </div>

        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-secondary-100 hover:bg-secondary-200 rounded-lg text-sm"
          >
            <Edit2 className="w-4 h-4" />
            <span>编辑</span>
          </button>
        ) : (
          <div className="flex space-x-2">
            <button
              onClick={handleSave}
              className="flex items-center space-x-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
            >
              <Save className="w-4 h-4" />
              <span>保存</span>
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-secondary-200 text-secondary-700 rounded-lg text-sm hover:bg-secondary-300"
            >
              取消
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            姓名
          </label>
          {isEditing ? (
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          ) : (
            <p className="text-secondary-900">{formData.name}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            年龄
          </label>
          {isEditing ? (
            <input
              type="number"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          ) : (
            <p className="text-secondary-900">{formData.age}岁</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            背景设定
          </label>
          {isEditing ? (
            <textarea
              value={formData.background}
              onChange={(e) => setFormData({ ...formData, background: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          ) : (
            <p className="text-secondary-900 text-sm leading-relaxed">{formData.background}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            性格特征
          </label>
          {isEditing ? (
            <textarea
              value={formData.personality}
              onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          ) : (
            <p className="text-secondary-900 text-sm leading-relaxed">{formData.personality}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            能力设定
          </label>
          {isEditing ? (
            <textarea
              value={formData.abilities}
              onChange={(e) => setFormData({ ...formData, abilities: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          ) : (
            <p className="text-secondary-900 text-sm leading-relaxed">{formData.abilities}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            人际关系
          </label>
          {isEditing ? (
            <textarea
              value={formData.relationships}
              onChange={(e) => setFormData({ ...formData, relationships: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          ) : (
            <p className="text-secondary-900 text-sm leading-relaxed">{formData.relationships}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            当前状态
          </label>
          {isEditing ? (
            <textarea
              value={formData.currentStatus}
              onChange={(e) => setFormData({ ...formData, currentStatus: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-secondary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          ) : (
            <p className="text-secondary-900 text-sm leading-relaxed">{formData.currentStatus}</p>
          )}
        </div>
      </div>

      {/* 成长记录 */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-secondary-700 mb-2">
          成长记录 ({formData.development.length})
        </label>
        <div className="space-y-2">
          {formData.development.map((record, index) => (
            <div key={index} className="p-3 bg-secondary-50 rounded-lg text-sm text-secondary-700">
              {record}
            </div>
          ))}
          {formData.development.length === 0 && (
            <p className="text-secondary-500 text-sm italic">暂无成长记录</p>
          )}
        </div>
      </div>
    </div>
  );
}