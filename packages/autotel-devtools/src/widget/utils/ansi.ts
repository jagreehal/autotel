/**
 * ANSI escape code parser for log coloring
 * Converts ANSI escape codes to HTML spans with Tailwind classes
 */

interface AnsiStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  fg?: string;
  bg?: string;
}

const ANSI_COLORS: Record<number, string> = {
  30: 'text-gray-900', // black
  31: 'text-red-600', // red
  32: 'text-green-600', // green
  33: 'text-yellow-600', // yellow
  34: 'text-blue-600', // blue
  35: 'text-purple-600', // magenta
  36: 'text-cyan-600', // cyan
  37: 'text-gray-100', // white
  90: 'text-gray-500', // bright black (gray)
  91: 'text-red-500', // bright red
  92: 'text-green-500', // bright green
  93: 'text-yellow-500', // bright yellow
  94: 'text-blue-500', // bright blue
  95: 'text-purple-500', // bright magenta
  96: 'text-cyan-500', // bright cyan
  97: 'text-gray-50', // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: 'bg-gray-900',
  41: 'bg-red-100',
  42: 'bg-green-100',
  43: 'bg-yellow-100',
  44: 'bg-blue-100',
  45: 'bg-purple-100',
  46: 'bg-cyan-100',
  47: 'bg-gray-100',
};

/**
 * Parse ANSI escape codes and return JSX-compatible segments
 */
export function parseAnsi(
  text: string,
): Array<{ text: string; style: AnsiStyle }> {
  // ANSI escape sequence pattern: ESC [ <params> m
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  const segments: Array<{ text: string; style: AnsiStyle }> = [];
  let currentStyle: AnsiStyle = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape code with current style
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        style: { ...currentStyle },
      });
    }

    // Parse the parameters
    const params = match[1] ? match[1].split(';').map(Number) : [0];

    // Update style based on parameters
    for (const code of params) {
      if (code === 0) {
        // Reset
        currentStyle = {};
      } else if (code === 1) {
        currentStyle.bold = true;
      } else if (code === 2) {
        currentStyle.dim = true;
      } else if (code === 3) {
        currentStyle.italic = true;
      } else if (code === 4) {
        currentStyle.underline = true;
      } else if (code >= 30 && code <= 37) {
        currentStyle.fg = ANSI_COLORS[code];
      } else if (code >= 90 && code <= 97) {
        currentStyle.fg = ANSI_COLORS[code];
      } else if (code >= 40 && code <= 47) {
        currentStyle.bg = ANSI_BG_COLORS[code];
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: { ...currentStyle },
    });
  }

  return segments.length > 0 ? segments : [{ text, style: {} }];
}

/**
 * Check if text contains ANSI codes
 */
export function hasAnsiCodes(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[[0-9;]*m/.test(text);
}

/**
 * Convert style object to Tailwind class string
 */
export function styleToClasses(style: AnsiStyle): string {
  const classes: string[] = [];

  if (style.bold) classes.push('font-bold');
  if (style.dim) classes.push('opacity-70');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('underline');
  if (style.fg) classes.push(style.fg);
  if (style.bg) classes.push(style.bg);

  return classes.join(' ');
}

/**
 * Strip ANSI codes from text (for plain text display)
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
