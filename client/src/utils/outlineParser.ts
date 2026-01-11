import { OutlineData } from '../types';

/**
 * 解析AI返回的Markdown格式大纲内容
 * 支持简单格式和详细格式
 */
export function parseOutlineContent(content: string): OutlineData[] {
  // 直接使用详细格式解析器，适用于新的AI输出格式
  return parseDetailedFormat(content);
}

/**
 * 解析详细格式的大纲内容
 */
function parseDetailedFormat(content: string): OutlineData[] {
  const outlines: OutlineData[] = [];
  const sections = content.split(/(?=### 架构\d+：)/);

  sections.forEach((section, index) => {
    if (!section.trim() || !section.includes('### 架构')) return;

    const outline: OutlineData = {
      id: index + 1,
      title: '',
      logline: '',
      hook: '',
      characters: '',
      world: '',
      themes: '',
      rawContent: section,
    };

    // 提取标题
    const titleMatch = section.match(/### 架构\d+：(.+)/);
    if (titleMatch) {
      outline.title = titleMatch[1].trim();
    }

    const lines = section.split('\n');
    let currentSection = '';

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      // 检测各部分开始
      if (trimmedLine === '核心概念：') {
        currentSection = 'logline';
      } else if (trimmedLine === '人物关系：') {
        currentSection = 'characters';
      } else if (trimmedLine === '世界观设定：') {
        currentSection = 'world';
      } else if (trimmedLine === '主要冲突：') {
        currentSection = 'hook';
      } else if (trimmedLine === '金手指设定：') {
        currentSection = 'themes';
      } else if (currentSection && trimmedLine && !trimmedLine.includes('：') && trimmedLine.length > 1) {
        // 累积内容，去掉markdown符号
        const cleanLine = trimmedLine
          .replace(/\*\*/g, '') // 去掉粗体符号
          .replace(/[🌍🎯👥💎🎣📖]/g, '') // 去掉表情符号
          .trim();

        if (cleanLine) {
          switch (currentSection) {
            case 'logline':
              outline.logline += (outline.logline ? ' ' : '') + cleanLine;
              break;
            case 'hook':
              outline.hook += (outline.hook ? '\n' : '') + cleanLine;
              break;
            case 'characters':
              outline.characters += (outline.characters ? '\n' : '') + cleanLine;
              break;
            case 'world':
              outline.world += (outline.world ? '\n' : '') + cleanLine;
              break;
            case 'themes':
              outline.themes += (outline.themes ? '\n' : '') + cleanLine;
              break;
          }
        }
      }
    });

    if (outline.title) {
      outlines.push(outline);
    }
  });

  return outlines;
}


/**
 * 格式化大纲内容用于显示
 */
export function formatOutlineForDisplay(outline: OutlineData): string {
  return `### ${outline.title}

核心概念：
${outline.logline}

人物关系：
${outline.characters}

世界观设定：
${outline.world}

主要冲突：
${outline.hook}

金手指设定：
${outline.themes}`;
}