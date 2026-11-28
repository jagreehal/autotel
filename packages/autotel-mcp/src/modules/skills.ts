/**
 * Skills over MCP (`io.modelcontextprotocol/skills`, SEP-2640): the skills
 * this server publishes, as the extension's `Skill` entries.
 *
 * Each file of a skill is a `skill://<name>/<path>` resource, read with
 * `resources/read`; `skills/list` and `skills/get` return the entries. The
 * catalog is generated from the repository's skills/ directory
 * (scripts/sync-skills.mjs), so the guidance ships with the server and
 * updates with it.
 */

import { SKILL_CATALOG } from './skills-catalog.generated';

export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills';

/**
 * `skills/list` and `skills/get` are cacheable results (`ttlMs` and
 * `cacheScope` are required). The catalog changes only with a release, and
 * it is the same for every caller.
 */
export const SKILLS_CACHE_HINT = {
  ttlMs: 300_000,
  cacheScope: 'public',
} as const;

/** One file of a published skill. */
export interface PublishedSkillFile {
  /** Path relative to the skill directory, `/`-separated. */
  path: string;
  text: string;
  /** `sha256:{hex}` of the file's bytes. */
  digest: string;
  /** Length of the file's bytes. */
  size: number;
}

/** A YAML frontmatter value, as JSON. */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

/** A skill as the catalog holds it. */
export interface PublishedSkill {
  name: string;
  /** The SKILL.md frontmatter, verbatim as JSON. */
  frontmatter: {
    name: string;
    description: string;
    [key: string]: FrontmatterValue;
  };
  files: PublishedSkillFile[];
}

/** A file's entry in a `Skill`: its URI, digest and size. */
export interface SkillResource {
  uri: string;
  digest: string;
  size: number;
}

/** The extension's `Skill` entry. */
export interface SkillEntry {
  uri: string;
  frontmatter: PublishedSkill['frontmatter'];
  resources: SkillResource[];
}

/** The resource URI of a skill's file. */
export function skillFileUri(skill: PublishedSkill, path: string): string {
  return `skill://${skill.name}/${path}`;
}

export function skillEntry(skill: PublishedSkill): SkillEntry {
  return {
    uri: skillFileUri(skill, 'SKILL.md'),
    frontmatter: skill.frontmatter,
    resources: skill.files.map((file) => ({
      uri: skillFileUri(skill, file.path),
      digest: file.digest,
      size: file.size,
    })),
  };
}

/** The skill whose SKILL.md is at `uri`, if this server serves it. */
export function findSkill(
  uri: string,
  catalog: readonly PublishedSkill[] = SKILL_CATALOG,
): PublishedSkill | undefined {
  return catalog.find((skill) => skillFileUri(skill, 'SKILL.md') === uri);
}

/** Markdown for `.md`, plain text otherwise: every published file is text. */
export function skillFileMimeType(path: string): string {
  return path.endsWith('.md') ? 'text/markdown' : 'text/plain';
}

export { SKILL_CATALOG };
