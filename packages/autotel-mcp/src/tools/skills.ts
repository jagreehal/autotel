/**
 * Skills over MCP on this server: every file of each published skill as a
 * `skill://` resource, plus the extension's `skills/list` and `skills/get`.
 *
 * The SDK has no Skills API, so the two methods are custom request handlers
 * on the underlying `Server`, as `events/*` are in ./events.ts.
 */

import { ProtocolError, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  findSkill,
  SKILL_CATALOG,
  SKILLS_CACHE_HINT,
  skillEntry,
  skillFileMimeType,
  skillFileUri,
} from '../modules/skills';

const ListParams = z.looseObject({ cursor: z.string().optional() });
const GetParams = z.looseObject({ uri: z.string() });
const AnyResult = z.looseObject({});

/** `-32602` for a URI that names no skill served here, as `resources/read` uses. */
const INVALID_PARAMS = -32_602;

export function registerSkills(server: McpServer): void {
  for (const skill of SKILL_CATALOG) {
    for (const file of skill.files) {
      const uri = skillFileUri(skill, file.path);
      const mimeType = skillFileMimeType(file.path);
      const metadata =
        file.path === 'SKILL.md'
          ? { description: skill.frontmatter.description, mimeType }
          : { mimeType };
      server.registerResource(
        file.path === 'SKILL.md' ? skill.name : `${skill.name}/${file.path}`,
        uri,
        metadata,
        async () => ({ contents: [{ uri, mimeType, text: file.text }] }),
      );
    }
  }

  // The catalog is small and fixed at build time: one page, cacheable like tools/list.
  server.server.setRequestHandler(
    'skills/list',
    { params: ListParams, result: AnyResult },
    async () => ({
      skills: SKILL_CATALOG.map((skill) => skillEntry(skill)),
      ...SKILLS_CACHE_HINT,
    }),
  );
  server.server.setRequestHandler(
    'skills/get',
    { params: GetParams, result: AnyResult },
    async (params: z.infer<typeof GetParams>) => {
      const skill = findSkill(params.uri);
      if (!skill) {
        throw new ProtocolError(INVALID_PARAMS, `No skill at ${params.uri}`);
      }
      return { skill: skillEntry(skill), ...SKILLS_CACHE_HINT };
    },
  );
}
