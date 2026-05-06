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
  const headingSplitRegex = /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:故事)?(?:架构|方案)\s*([0-9一二三四五六七八九十]+)\s*[:：\-—]\s*(.+?)(?:\*\*)?\s*$/gmi;
  const headingLineRegex = /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:故事)?(?:架构|方案)\s*([0-9一二三四五六七八九十]+)\s*[:：\-—]\s*(.+?)(?:\*\*)?\s*$/i;
  const headings = Array.from(content.matchAll(headingSplitRegex));
  const sections = headings.length > 0
    ? headings.map((match, index) => {
        const start = match.index ?? 0;
        const end = headings[index + 1]?.index ?? content.length;
        return content.slice(start, end);
      })
    : [content];

  sections.forEach((section, index) => {
    if (!section.trim()) return;

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
    const titleMatch = section.match(headingLineRegex);
    const firstLine = section.split('\n').find(line => line.trim());
    outline.title = cleanOutlineLine(titleMatch?.[2] || firstLine || '')
      .replace(/^(?:#{1,6}\s*)?(?:故事)?(?:架构|方案)\s*[0-9一二三四五六七八九十]+\s*[:：\-—]\s*/, '')
      .trim();

    const lines = section.split('\n');
    let currentSection = '';

    lines.forEach((line) => {
      const trimmedLine = cleanOutlineLine(line);
      const labelMatch = trimmedLine.match(/^(.{1,32}?)[：:]\s*(.*)$/);
      const label = labelMatch?.[1]?.trim();
      const inlineContent = labelMatch?.[2]?.trim() || '';
      const nextSection = label ? getOutlineSectionKey(label) : '';

      // 检测各部分开始
      if (nextSection) {
        currentSection = nextSection;
        appendOutlineSection(outline, currentSection, inlineContent);
      } else if (
        currentSection &&
        trimmedLine &&
        !headingLineRegex.test(trimmedLine) &&
        trimmedLine.length > 1
      ) {
        appendOutlineSection(outline, currentSection, trimmedLine);
      }
    });

    if (
      outline.title &&
      (outline.logline || outline.characters || outline.world || outline.hook || outline.themes)
    ) {
      outlines.push(outline);
    }
  });

  return outlines;
}

function cleanOutlineLine(line: string): string {
  return line
    .trim()
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)、]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/[🌍🎯👥💎🎣📖]/g, '')
    .trim();
}

function getOutlineSectionKey(label: string): keyof Pick<OutlineData, 'logline' | 'characters' | 'world' | 'hook' | 'themes'> | '' {
  const normalized = label
    .replace(/\s+/g, '')
    .replace(/[【】\[\]（）()]/g, '')
    .toLowerCase();

  if (['核心概念', '一句话核心', '故事核心', 'coreconcept', 'logline', 'premise'].includes(normalized)) {
    return 'logline';
  }
  if (['人物关系', '角色关系', '人物设定', '角色设定', 'characters', 'characterdynamics', 'cast'].includes(normalized)) {
    return 'characters';
  }
  if (['世界观设定', '世界设定', '世界观', 'worldsetting', 'worldbuilding', 'setting'].includes(normalized)) {
    return 'world';
  }
  if (['主要冲突', '核心冲突', '主线冲突', 'mainconflict', 'conflict'].includes(normalized)) {
    return 'hook';
  }
  if (['金手指设定', '金手指', '独特能力', '爽点机制', 'specialpower', 'cheat', 'power', 'hook'].includes(normalized)) {
    return 'themes';
  }

  return '';
}

function appendOutlineSection(outline: OutlineData, section: string, content: string) {
  const cleanContent = cleanOutlineLine(content);
  if (!cleanContent) return;

  switch (section) {
    case 'logline':
      outline.logline += (outline.logline ? ' ' : '') + cleanContent;
      break;
    case 'hook':
      outline.hook += (outline.hook ? '\n' : '') + cleanContent;
      break;
    case 'characters':
      outline.characters += (outline.characters ? '\n' : '') + cleanContent;
      break;
    case 'world':
      outline.world += (outline.world ? '\n' : '') + cleanContent;
      break;
    case 'themes':
      outline.themes += (outline.themes ? '\n' : '') + cleanContent;
      break;
  }
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
