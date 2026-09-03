import type { APIRoute, GetStaticPaths } from 'astro';
import { loadAgentSkills } from '../../../../lib/agent-skills';

/** Serves each SKILL.md the discovery index points at, so digests always match. */
export const getStaticPaths: GetStaticPaths = () =>
  loadAgentSkills().map(({ name, body }) => ({
    params: { skill: name },
    props: { body },
  }));

export const GET: APIRoute = ({ props }) =>
  new Response(props.body as string, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
