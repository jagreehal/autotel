import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Repo-root `.claude/skills`, relative to `apps/docs` (the build cwd). */
const SKILLS_DIR = resolve(process.cwd(), '../../.claude/skills');

export type AgentSkill = {
  /** Directory name, which is also the skill's frontmatter `name`. */
  name: string;
  description: string;
  /** `sha256:<hex>` over the exact bytes served at the skill's url. */
  digest: string;
  body: string;
};

/**
 * Pull `description` out of a SKILL.md YAML frontmatter block, supporting both
 * `description: text` and the folded `description: >` form. Deliberately not a
 * YAML parser: these are the only two shapes Claude Code skills use, and a
 * dependency for one field is not worth it.
 */
function readDescription(source: string, name: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1];
  if (!frontmatter) throw new Error(`${name}/SKILL.md has no frontmatter`);

  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('description:'));
  if (start === -1) throw new Error(`${name}/SKILL.md has no description`);

  const inline = lines[start].slice('description:'.length).trim();
  if (inline && inline !== '>' && inline !== '|') return inline;

  // Folded/literal block: take the indented lines that follow.
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line.trim());
  }
  if (block.length === 0)
    throw new Error(`${name}/SKILL.md description is empty`);
  return block.join(' ');
}

export function loadAgentSkills(): AgentSkill[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const body = readFileSync(
        join(SKILLS_DIR, entry.name, 'SKILL.md'),
        'utf8',
      );
      return {
        name: entry.name,
        description: readDescription(body, entry.name),
        digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
        body,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
