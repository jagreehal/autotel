import { describe, it, expect } from 'vitest';
import {
  parseAnsi,
  hasAnsiCodes,
  styleToClasses,
  stripAnsi,
} from '../utils/ansi';

describe('ANSI Parser', () => {
  describe('hasAnsiCodes', () => {
    it('detects ANSI codes in text', () => {
      expect(hasAnsiCodes('\x1b[31mred text\x1b[0m')).toBe(true);
      expect(hasAnsiCodes('\x1b[1mbold\x1b[0m')).toBe(true);
      expect(hasAnsiCodes('plain text')).toBe(false);
      expect(hasAnsiCodes('text with \x1b[32mgreen\x1b[0m')).toBe(true);
    });
  });

  describe('parseAnsi', () => {
    it('parses simple color codes', () => {
      const segments = parseAnsi('\x1b[31mred text\x1b[0m');
      expect(segments).toHaveLength(2);
      expect(segments[0].text).toBe('red text');
      expect(segments[0].style.fg).toBe('text-red-600');
      expect(segments[1].text).toBe('');
    });

    it('parses bold text', () => {
      const segments = parseAnsi('\x1b[1mbold\x1b[0m');
      expect(segments).toHaveLength(2);
      expect(segments[0].style.bold).toBe(true);
    });

    it('parses combined codes', () => {
      const segments = parseAnsi('\x1b[1;31mbold red\x1b[0m');
      expect(segments[0].style.bold).toBe(true);
      expect(segments[0].style.fg).toBe('text-red-600');
    });

    it('handles text without codes', () => {
      const segments = parseAnsi('plain text');
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('plain text');
      expect(segments[0].style).toEqual({});
    });

    it('preserves text before and after codes', () => {
      const segments = parseAnsi('before \x1b[31mred\x1b[0m after');
      expect(segments).toHaveLength(3);
      expect(segments[0].text).toBe('before ');
      expect(segments[0].style).toEqual({});
      expect(segments[1].text).toBe('red');
      expect(segments[1].style.fg).toBe('text-red-600');
      expect(segments[2].text).toBe(' after');
      expect(segments[2].style).toEqual({});
    });

    it('parses all foreground colors', () => {
      const colors = [
        { code: 30, class: 'text-gray-900' },
        { code: 31, class: 'text-red-600' },
        { code: 32, class: 'text-green-600' },
        { code: 33, class: 'text-yellow-600' },
        { code: 34, class: 'text-blue-600' },
        { code: 35, class: 'text-purple-600' },
        { code: 36, class: 'text-cyan-600' },
        { code: 37, class: 'text-gray-100' },
      ];

      for (const { code, class: className } of colors) {
        const segments = parseAnsi(`\x1b[${code}mtext\x1b[0m`);
        expect(segments[0].style.fg).toBe(className);
      }
    });

    it('parses bright colors', () => {
      const segments = parseAnsi('\x1b[91mbright red\x1b[0m');
      expect(segments[0].style.fg).toBe('text-red-500');
    });

    it('parses background colors', () => {
      const segments = parseAnsi('\x1b[41mred background\x1b[0m');
      expect(segments[0].style.bg).toBe('bg-red-100');
    });
  });

  describe('styleToClasses', () => {
    it('converts style to Tailwind classes', () => {
      const classes = styleToClasses({
        bold: true,
        italic: true,
        fg: 'text-red-600',
        bg: 'bg-red-100',
      });
      expect(classes).toContain('font-bold');
      expect(classes).toContain('italic');
      expect(classes).toContain('text-red-600');
      expect(classes).toContain('bg-red-100');
    });

    it('returns empty string for empty style', () => {
      expect(styleToClasses({})).toBe('');
    });
  });

  describe('stripAnsi', () => {
    it('removes ANSI codes from text', () => {
      expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
      expect(stripAnsi('before \x1b[1mbold\x1b[0m after')).toBe(
        'before bold after',
      );
      expect(stripAnsi('plain text')).toBe('plain text');
    });
  });
});
