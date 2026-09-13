import type { On } from 'claude-code';

import type { Autotel } from '../types';

import { createExporter, parseHeaders } from './otlp';
import {
  createRecorder,
  badge,
  type DispatchStart,
  type Recorder,
} from './recorder';

/** The name `.claude-plugin/plugin.json` declares; `next.origin.plugin` reads it. */
export const PLUGIN_NAME = 'autotel';

/**
 * The dispatches worth a span: where time goes and where a hook can say no.
 * Every `classic.*` shell hook counts. The rest of the engine's calls
 * (`tool.describe`, `agent.offer`, `prompt.section`, every getter, every
 * draw) fire dozens of times per turn and say nothing a trace should carry;
 * a `clock.after` is also how the exporter's own batch timer fires.
 */
const TRACED = new Set<DispatchStart['event']>([
  'prompt.submit',
  'turn.start',
  'turn.step',
  'turn.complete',
  'turn.abort',
  'tool.call',
  'tool.check',
  'mcp.call',
  'model.complete',
  'model.classify',
  'model.fork',
  'process.run',
  'http.fetch',
  'fs.read',
  'fs.write',
  'command.run',
  'agent.spawn',
  'session.start',
  'session.compact',
  'plugin.register',
  'ui.press',
]);

function isTraced(event: DispatchStart['event']): boolean {
  return TRACED.has(event) || event.startsWith('classic.');
}

/**
 * Registers the mod's hooks. Each reads the engine's `e` and `next` into the
 * recorder's plain values at the boundary; what to record is decided there.
 *
 * `engine.create` adds `$.autotel`; `session.start` turns the exporter on
 * over `$.http`, `$.clock` and `$.env` when `OTEL_EXPORTER_OTLP_ENDPOINT` is
 * set. The `*` hook records one span per dispatch with the chain beneath it
 * as span events, one per link. The `ToolUse` render hook draws each call's
 * settled duration beside its row.
 *
 * @param on the engine's registrar
 */
export function register(on: On) {
  let recorder: Recorder = createRecorder(undefined);

  // The noun is one object for the life of the fold, delegating to whichever
  // recorder is current: inert until `session.start` has read the
  // environment, exporting after.
  const autotel: Autotel = {
    span: (name, fn, attributes) => recorder.autotel.span(name, fn, attributes),
  };

  on('engine.create', async ($, e, next) => ({
    ...(await next(e)),
    autotel,
  }));

  // `$` admits no call during the fold, so the environment is read once the
  // session has started, the way the built-in telemetry mod reads it lazily.
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    const endpoint = await $.env.get('OTEL_EXPORTER_OTLP_ENDPOINT');
    if (endpoint === undefined || endpoint === '') return started;

    const serviceName = (await $.env.get('OTEL_SERVICE_NAME')) ?? 'claude-code';
    recorder = createRecorder(
      createExporter({
        fetch: (url, init) => $.http.fetch(url, init),
        after: (ms, fn) => $.clock.after(ms, fn),
        endpoint,
        headers: parseHeaders(await $.env.get('OTEL_EXPORTER_OTLP_HEADERS')),
        resource: {
          'service.name': serviceName,
          'session.id': await $.session.id(),
        },
      }),
    );
    return started;
  });

  on('*', async ($, e, next) => {
    if (!isTraced(next.event) || next.origin.plugin === PLUGIN_NAME)
      return next(e);

    const start: DispatchStart = { event: next.event, origin: next.origin };
    if (next.is('tool.call', e)) {
      start.tool = { name: e.tool, useId: e.tool_use_id };
      if (e.agentId !== undefined) start.tool.agentId = e.agentId;
    }
    if (next.event === 'prompt.submit' || next.event === 'turn.start')
      start.opensTurn = true;
    if (next.is('turn.start', e)) start.turnId = e.turnId;
    const settle = recorder.begin(start);

    const end: Parameters<typeof settle>[0] = { trace: [] };
    try {
      if (next.is('tool.call', e)) {
        const result = await next(e);
        end.denied = result.deny !== undefined;
        return result;
      }
      if (next.is('prompt.submit', e)) {
        const result = await next(e);
        if (result.drop !== undefined) end.promptDropped = result.drop;
        return result;
      }
      return await next(e);
    } catch (thrown) {
      end.error = String(thrown);
      throw thrown;
    } finally {
      end.trace = next.trace;
      if (next.is('turn.complete', e)) {
        end.turnComplete = {
          turnId: e.turnId,
          reason: e.reason,
          isAborted: e.isAborted,
          durationMs: e.durationMs,
        };
        if (e.agentId !== undefined) end.turnComplete.agentId = e.agentId;
      }
      settle(end);
      if (next.event === 'classic.SessionEnd') void recorder.flush();
    }
  });

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const rendered = await next(e);
    const timing = recorder.timingFor(e.props.tool_use_id);
    if (timing === undefined || e.props.isRunning) return rendered;
    const { Box, Text } = await $.ui.resolve(e);
    return Box({
      children: [rendered, Text({ dimColor: true, children: badge(timing) })],
    });
  });
}
