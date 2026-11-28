import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../scripts/sync-skills.mjs';
import {
  findSkill,
  SKILL_CATALOG,
  skillEntry,
  skillFileUri,
} from '../src/modules/skills';

describe('published skills', () => {
  it('match the repository skills/ they were generated from', () => {
    // Run `pnpm sync:skills` when this fails after editing a published skill.
    expect(SKILL_CATALOG).toEqual(buildCatalog());
  });

  it('name each skill after the last segment of its URI, and list every file with its digest', () => {
    for (const skill of SKILL_CATALOG) {
      const entry = skillEntry(skill);
      expect(entry.uri).toBe(`skill://${skill.frontmatter.name}/SKILL.md`);
      expect(entry.resources.map((r) => r.uri)).toContain(entry.uri);
      for (const file of skill.files) {
        const bytes = Buffer.from(file.text, 'utf8');
        expect(file.size).toBe(bytes.length);
        expect(file.digest).toBe(
          `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        );
      }
    }
  });

  it('finds a skill only by the URI of its SKILL.md', () => {
    const [first] = SKILL_CATALOG;
    expect(first).toBeDefined();
    expect(findSkill(skillFileUri(first!, 'SKILL.md'))).toBe(first);
    expect(findSkill(`skill://${first!.name}`)).toBeUndefined();
    expect(findSkill('skill://made-up/SKILL.md')).toBeUndefined();
  });
});
