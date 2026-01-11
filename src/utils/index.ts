// 工具函数
// TODO: 添加工具函数

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

// TODO: 添加更多工具函数