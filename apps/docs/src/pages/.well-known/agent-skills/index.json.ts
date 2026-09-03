import type { APIRoute } from 'astro';
import { loadAgentSkills } from '../../../lib/agent-skills';

/** Agent Skills Discovery index (RFC v0.2.0) for the skills this repo ships. */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  const body = {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: loadAgentSkills().map(({ name, description, digest }) => ({
      name,
      type: 'skill-md',
      description,
      url: new URL(`${base}/.well-known/agent-skills/${name}/SKILL.md`, site)
        .href,
      digest,
    })),
  };

  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
