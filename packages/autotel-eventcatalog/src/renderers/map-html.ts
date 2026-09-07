// Render a LiveMap as one self-contained HTML file.
//
// Three modes, one artifact, because they differ only in what moves:
//
//   static — nothing moves. Weight and dash carry the whole message.
//   replay — observed edges emit markers at a rate drawn from their snapshot
//            count. A file you can commit and open in a PR.
//   live   — the same page subscribes to an SSE endpoint and a marker crosses an
//            edge when that event actually fires.
//
// Motion is reserved for evidence. A declared-only edge never moves in any
// mode, because that stillness is the finding: documented, believed, and not
// seen once in this run. An asserted edge (`consumed-by`) moves with a hollow
// marker — the event really fired, that this consumer received it is a claim.
//
// No dependencies, no build step, no network beyond the optional SSE URL.

import { normaliseEventId } from '../diff.js';
import { describeSuggestion } from '../suggest.js';
import type { LiveMap, MapEdge, MapNode } from '../map.js';

export type MapMode = 'static' | 'replay' | 'live';

export type RenderMapOptions = {
  mode?: MapMode;
  /** SSE endpoint emitting `{ name, producer?, channel? }`. Live mode only. */
  liveUrl?: string;
  /**
   * SSE event name to listen for. Defaults to `message`, which is what an
   * unnamed `data:` frame arrives as — a server that writes `event: track`
   * delivers nothing to a `message` listener, and the page would sit silently
   * claiming to be live.
   */
  liveEventName?: string;
  title?: string;
};

const COLUMN_X = { service: 130, event: 470, channel: 810 } as const;
const NODE_W = { service: 190, event: 210, channel: 180 } as const;
const NODE_H = 52;
const ROW_GAP = 30;
const PADDING_TOP = 132;
const LANE_GAP = 20;

type Placed = MapNode & { x: number; y: number; w: number };

/**
 * Serialise data for embedding inside a `<script>` block.
 *
 * An HTML parser ends the script at the first `</script`, wherever it sits —
 * including inside a JSON string — so a catalog event named `</script><img
 * onerror=...>` would otherwise close the block and execute. Escaping `<` as
 * `\u003c` makes that impossible while still parsing back to the same value,
 * since JSON treats the escape as the character it names.
 *
 * U+2028 and U+2029 are legal in JSON strings and are line terminators to a
 * JavaScript parser, which would end the statement mid-literal.
 */
function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('\u2028', String.raw`\u2028`)
    .replaceAll('\u2029', String.raw`\u2029`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Column layout. Services stay in one column, so a service that both produces
 * and consumes is one box rather than two; `consumed-by` edges travel back to
 * reach it, in nested lanes under the band so a return path never crosses the
 * forward flow it is returning from.
 */
function layout(map: LiveMap): {
  placed: Map<string, Placed>;
  height: number;
  bandBottom: number;
  lanes: Map<string, number>;
} {
  const columns: Record<MapNode['kind'], MapNode[]> = {
    service: [],
    event: [],
    channel: [],
  };
  for (const node of map.nodes) columns[node.kind].push(node);

  const placed = new Map<string, Placed>();
  let maxRows = 0;
  for (const kind of ['service', 'event', 'channel'] as const) {
    const list = columns[kind];
    maxRows = Math.max(maxRows, list.length);
    for (const [index, node] of list.entries()) {
      placed.set(node.id, {
        ...node,
        x: COLUMN_X[kind],
        y: PADDING_TOP + index * (NODE_H + ROW_GAP),
        w: NODE_W[kind],
      });
    }
  }
  const bandBottom = PADDING_TOP + maxRows * (NODE_H + ROW_GAP);

  // One lane per return edge. Longer spans go deeper, so the arcs nest instead
  // of intersecting — the shape reads as "these all come back" at a glance.
  const returns = map.edges.filter((edge) => edge.kind === 'consumed-by');
  const lanes = new Map<string, number>();
  const spans = returns
    .map((edge) => {
      const from = placed.get(edge.source);
      const to = placed.get(edge.target);
      return { id: edge.id, span: from && to ? Math.abs(from.y - to.y) : 0 };
    })
    .toSorted((a, b) => a.span - b.span);
  for (const [index, entry] of spans.entries()) lanes.set(entry.id, index);

  const deepest = lanes.size === 0 ? 0 : lanes.size * LANE_GAP;
  return {
    placed,
    bandBottom,
    lanes,
    height: bandBottom + deepest + 62,
  };
}

function edgePath(
  from: Placed,
  to: Placed,
  kind: MapEdge['kind'],
  bandBottom: number,
  lane: number,
): string {
  const y1 = from.y + NODE_H / 2;
  const y2 = to.y + NODE_H / 2;
  if (kind === 'consumed-by') {
    // Straight down out of the event's underside, along a lane beneath every
    // node, then straight up into the consumer's. Leaving the band entirely is
    // what keeps a return edge from reading as another forward arrow, and
    // dropping from the box edges keeps it from bulging around the columns.
    const x1 = from.x;
    const x2 = to.x;
    const top1 = from.y + NODE_H;
    const top2 = to.y + NODE_H;
    const depth = bandBottom + 24 + lane * LANE_GAP;
    const r = 12;
    const dir = x2 < x1 ? -1 : 1;
    return [
      `M ${x1} ${top1}`,
      `L ${x1} ${depth - r}`,
      `Q ${x1} ${depth} ${x1 + dir * r} ${depth}`,
      `L ${x2 - dir * r} ${depth}`,
      `Q ${x2} ${depth} ${x2} ${depth - r}`,
      `L ${x2} ${top2}`,
    ].join(' ');
  }
  const x1 = from.x + from.w / 2;
  const x2 = to.x - to.w / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * The normalised event id an edge answers to.
 *
 * Derived from the event endpoint rather than from `eventKey`, which only
 * exists once something has been observed — a declared-but-never-seen edge has
 * to be matchable too, or live evidence could never reach it.
 */
function matchKeyOf(edge: MapEdge): string {
  const eventId = edge.kind === 'produces' ? edge.target : edge.source;
  return normaliseEventId(stripPrefix(eventId, 'event:'));
}

function strokeWidth(edge: MapEdge): number {
  if (edge.liveness === 'declared-only') return 1.25;
  return Math.min(6, 1.5 + Math.log10(Math.max(edge.count, 1)) * 2.2);
}

export function renderLiveMapHtml(
  map: LiveMap,
  options: RenderMapOptions = {},
): string {
  const mode: MapMode = options.mode ?? 'static';
  const { placed, height, bandBottom, lanes } = layout(map);
  const width = 1040;
  const title = options.title ?? `${map.service} — live map`;

  const edgeMarkup = map.edges
    .map((edge) => {
      const from = placed.get(edge.source);
      const to = placed.get(edge.target);
      if (!from || !to) return '';
      const classes = [
        'edge',
        `liveness-${edge.liveness}`,
        `evidence-${edge.evidence}`,
        `kind-${edge.kind}`,
      ].join(' ');
      const label =
        edge.liveness === 'declared-only'
          ? 'declared, never observed in this run'
          : `${edge.count} observation${edge.count === 1 ? '' : 's'}${
              edge.exactCount
                ? ''
                : ' (event total — this snapshot predates per-relationship counts and cannot separate two producers of one event)'
            }${
              edge.evidence === 'asserted'
                ? ' · consumer asserted, not observed'
                : ''
            }`;
      const d = edgePath(
        from,
        to,
        edge.kind,
        bandBottom,
        lanes.get(edge.id) ?? 0,
      );
      return `<path id="${escapeHtml(edge.id)}" class="${classes}" d="${d}" stroke-width="${strokeWidth(edge)}" fill="none"><title>${escapeHtml(`${edge.source} → ${edge.target}\n${label}`)}</title></path>`;
    })
    .join('\n      ');

  const nodeMarkup = [...placed.values()]
    .map((node) => {
      const x = node.x - node.w / 2;
      const countLabel =
        node.liveness === 'declared-only'
          ? 'never seen'
          : `${node.count.toLocaleString()} seen`;
      return `<g class="node kind-${node.kind} liveness-${node.liveness}" data-node-id="${escapeHtml(node.id)}" transform="translate(${x} ${node.y})">
        <rect width="${node.w}" height="${NODE_H}" rx="10"></rect>
        <text class="label" x="14" y="21">${escapeHtml(node.label)}</text>
        <text class="meta" x="14" y="39" data-count="${node.count}">${escapeHtml(countLabel)}</text>
      </g>`;
    })
    .join('\n      ');

  const s = map.summary;
  const config = toScriptJson({
    mode,
    liveUrl: options.liveUrl ?? null,
    liveEventName: options.liveEventName ?? 'message',
    // Keyed independently of edges: a catalog can declare an event that no
    // service sends or receives, which has no edge to be found through.
    eventNodes: Object.fromEntries(
      map.nodes
        .filter((node) => node.kind === 'event')
        .map((node) => [
          normaliseEventId(stripPrefix(node.id, 'event:')),
          node.id,
        ]),
    ),
    edges: map.edges.map((edge) => ({
      id: edge.id,
      liveness: edge.liveness,
      evidence: edge.evidence,
      count: edge.count,
      // Matching is per-relationship, not per-event name: a live frame lights
      // up the producer and channel it actually names, never a different
      // service's arrow to the same event.
      matchKey: matchKeyOf(edge),
      kind: edge.kind,
      source: edge.source,
      target: edge.target,
      producer:
        edge.kind === 'produces' ? stripPrefix(edge.source, 'service:') : null,
      channel:
        edge.kind === 'publishes-to'
          ? stripPrefix(edge.target, 'channel:')
          : null,
    })),
  });

  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa; --panel: #ffffff; --ink: #11151c; --muted: #5b6473;
    --line: #d7dbe2;
    --observed: #2563eb; --declared: #98a1b0; --undocumented: #d97706;
    --observed-fill: #eff4ff; --undocumented-fill: #fff7ed;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --panel: #161b22; --ink: #e6edf3; --muted: #8d97a5;
      --line: #2b3038;
      --observed: #60a5fa; --declared: #4b535f; --undocumented: #f59e0b;
      --observed-fill: #12203a; --undocumented-fill: #2a1e0c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { padding: 22px 28px 6px; }
  h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  .wrap { padding: 0 28px 28px; }
  .card { background: var(--panel); border: 1px solid var(--line);
    border-radius: 14px; overflow-x: auto; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 20px 4px; }
  .stat { border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px;
    min-width: 132px; background: var(--bg); }
  .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--muted); font-size: 12px; }
  .stat.alert b { color: var(--undocumented); }
  .notes { padding: 4px 20px 12px; border-top: 1px solid var(--line); }
  .note-title { margin: 12px 0 6px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
  .note { margin: 0 0 4px; font-size: 12.5px; color: var(--muted); }
  .note-foot { margin: 6px 0 2px; font-size: 12px; color: var(--muted); opacity: 0.85; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 12px 20px 16px;
    color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--line); }
  .legend i { display: inline-block; width: 26px; height: 0; vertical-align: middle;
    border-top-width: 2.5px; border-top-style: solid; margin-right: 7px; }
  svg { display: block; min-width: ${width}px; }
  .node rect { fill: var(--panel); stroke: var(--line); stroke-width: 1.25; }
  .node .label { font-size: 13px; font-weight: 600; fill: var(--ink); }
  .node .meta { font-size: 11px; fill: var(--muted); }
  .node.liveness-observed rect { stroke: var(--observed); fill: var(--observed-fill); }
  .node.liveness-undocumented rect { stroke: var(--undocumented); fill: var(--undocumented-fill); }
  .node.liveness-declared-only rect { stroke-dasharray: 4 3; }
  .node.liveness-declared-only .label { fill: var(--muted); }
  .edge { stroke: var(--observed); }
  .edge.liveness-declared-only { stroke: var(--declared); stroke-dasharray: 6 5; }
  .edge.liveness-undocumented { stroke: var(--undocumented); }
  .edge.evidence-asserted { stroke-dasharray: 2 4; }
  .marker { r: 4.5; fill: var(--observed); }
  .marker.asserted { fill: none; stroke: var(--observed); stroke-width: 1.6; }
  .marker.undocumented { fill: var(--undocumented); }
  .pulse { animation: pulse 620ms ease-out; }
  @keyframes pulse { from { stroke-opacity: 1; stroke-width: 7; } to { stroke-opacity: 0.85; } }
  footer { padding: 14px 28px 30px; color: var(--muted); font-size: 12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">Snapshot <code>${escapeHtml(map.generatedAt)}</code> · mode <code>${mode}</code>${
    mode === 'live' ? ' · <span id="live-status">connecting…</span>' : ''
  }</div>
</header>
<div class="wrap">
  <div class="card">
    <div class="stats">
      <div class="stat"><b id="stat-observed">${s.observedEdges}</b><span>observed edges</span></div>
      <div class="stat${s.declaredOnlyEdges > 0 ? ' alert' : ''}" id="tile-declared"><b id="stat-declared">${s.declaredOnlyEdges}</b><span>declared, never seen</span></div>
      <div class="stat${s.undocumentedEdges > 0 ? ' alert' : ''}"><b id="stat-undocumented">${s.undocumentedEdges}</b><span>ran, undocumented</span></div>
      <div class="stat"><b>${s.assertedEdges}</b><span>asserted (unobservable)</span></div>
      <div class="stat"><b>${s.totalObservations.toLocaleString()}</b><span>observations</span></div>
    </div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img"
         aria-label="Catalog topology annotated with runtime observations">
      <g id="edges">
      ${edgeMarkup}
      </g>
      <g id="markers"></g>
      <g id="nodes">
      ${nodeMarkup}
      </g>
    </svg>
    ${
      map.suggestions.length > 0
        ? `<div class="notes">
      <p class="note-title">Possible renames</p>
      ${map.suggestions
        .map(
          (suggestion) =>
            `<p class="note">${escapeHtml(describeSuggestion(suggestion).replaceAll('`', ''))}</p>`,
        )
        .join('\n      ')}
      <p class="note-foot">Shown as two findings above, because one of them is a real removal on the day a rename is not what happened.</p>
    </div>`
        : ''
    }
    ${
      s.assertedEdges > 0
        ? `<div class="notes">
      <p class="note-title">Why ${s.assertedEdges} relationship${s.assertedEdges === 1 ? '' : 's'} cannot be confirmed</p>
      <p class="note">A producer's telemetry proves an event fired. It cannot prove anyone received it, so consumer arrows stay dotted however busy the event is, and a consumer never gains a count from a producer's frame.</p>
      <p class="note-foot">Measured consumption is not supported yet: snapshots are built from <code>track()</code> events, and consumer spans are not read. Until that lands, every consumer arrow here is a declaration — from the catalog's <code>receives</code>, or the producer's <code>_autotel.consumers</code> — and not a measurement.</p>
    </div>`
        : ''
    }
    <div class="legend">
      <span><i style="border-color: var(--observed)"></i>observed — a real <code>track()</code> call crossed this</span>
      <span><i style="border-color: var(--declared); border-top-style: dashed"></i>declared, never seen in this run</span>
      <span><i style="border-color: var(--undocumented)"></i>ran, not in the catalog</span>
      <span><i style="border-color: var(--observed); border-top-style: dotted"></i>consumer asserted — not observable from producer telemetry</span>
    </div>
  </div>
</div>
<footer>
  Motion means evidence. A still edge was never observed in this run, and a hollow
  marker means the event fired but its delivery to that consumer is a claim, not a
  measurement.
</footer>
<script>
(() => {
  const config = ${config};
  const svg = document.querySelector('svg');
  const markerLayer = document.getElementById('markers');
  if (!svg || !markerLayer) return;

  // Same rule as normaliseEventId in diff.ts, which is what decided these
  // edges' match keys. A test pins the two together; if they drift, a live
  // frame stops finding the edge it belongs to.
  const normalise = (id) => String(id).toLowerCase().replaceAll(/[._\-\s]/g, '');

  const edges = new Map();
  for (const edge of config.edges) {
    const path = document.getElementById(edge.id);
    if (path instanceof SVGPathElement) edges.set(edge.id, { ...edge, path });
  }

  // Every edge is indexed, including the ones that have never been seen. They
  // are still forbidden to move until evidence arrives: promote() is the only
  // thing that lifts that, and only a matching live frame calls it.
  const byMatchKey = new Map();
  for (const edge of edges.values()) {
    const list = byMatchKey.get(edge.matchKey) ?? [];
    list.push(edge);
    byMatchKey.set(edge.matchKey, list);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const counts = {
    observed: Number(document.getElementById('stat-observed')?.textContent) || 0,
    declared: Number(document.getElementById('stat-declared')?.textContent) || 0,
  };

  function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  /**
   * An edge seen for the first time is no longer "declared, never seen". Repaint
   * it, move it between the counters, and let it animate from now on. Without
   * this a map opened before the first event would sit still forever while
   * reporting itself live.
   */
  function promote(edge) {
    if (edge.liveness !== 'declared-only') return;
    edge.liveness = 'observed';
    edge.path.classList.remove('liveness-declared-only');
    edge.path.classList.add('liveness-observed');
    counts.observed += 1;
    counts.declared -= 1;
    setStat('stat-observed', counts.observed);
    setStat('stat-declared', counts.declared);
    if (counts.declared === 0) {
      document.getElementById('tile-declared')?.classList.remove('alert');
    }
  }

  // Counts are rendered from the snapshot, so without this a node keeps saying
  // "never seen" while the edge beside it is visibly moving.
  function bumpNode(id) {
    const group = document.querySelector('[data-node-id="' + CSS.escape(id) + '"]');
    const meta = group && group.querySelector('.meta');
    if (!group || !meta) return;
    const next = (Number(meta.dataset.count) || 0) + 1;
    meta.dataset.count = String(next);
    meta.textContent = next.toLocaleString() + ' seen';
    if (group.classList.contains('liveness-declared-only')) {
      group.classList.remove('liveness-declared-only');
      group.classList.add('liveness-observed');
    }
  }

  function send(edge) {
    // Stillness is the finding: an edge with no evidence never moves.
    if (edge.liveness === 'declared-only') return;
    if (reduced) {
      edge.path.classList.add('pulse');
      setTimeout(() => edge.path.classList.remove('pulse'), 620);
      return;
    }
    const length = edge.path.getTotalLength();
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class',
      'marker' + (edge.evidence === 'asserted' ? ' asserted' : '') +
      (edge.liveness === 'undocumented' ? ' undocumented' : ''));
    markerLayer.append(dot);
    const started = performance.now();
    const duration = 950;
    function step(now) {
      const t = Math.min(1, (now - started) / duration);
      const point = edge.path.getPointAtLength(t * length);
      dot.setAttribute('cx', String(point.x));
      dot.setAttribute('cy', String(point.y));
      if (t < 1) requestAnimationFrame(step);
      else dot.remove();
    }
    requestAnimationFrame(step);
  }

  if (config.mode === 'replay') {
    const observed = [...edges.values()].filter(
      (edge) => edge.liveness !== 'declared-only' && edge.count > 0,
    );
    const busiest = Math.max(1, ...observed.map((edge) => edge.count));
    for (const edge of observed) {
      const interval = Math.round(2600 - (edge.count / busiest) * 2000);
      setTimeout(() => {
        send(edge);
        setInterval(() => send(edge), interval);
      }, Math.random() * interval);
    }
  }

  if (config.mode === 'live' && config.liveUrl) {
    const status = document.getElementById('live-status');
    let unmapped = 0;
    let unknownProducers = 0;
    let unknownChannels = 0;
    const source = new EventSource(config.liveUrl);
    source.addEventListener('open', () => {
      if (status) status.textContent = 'live';
    });
    source.addEventListener('error', () => {
      if (status) status.textContent = 'disconnected — retrying';
    });
    source.addEventListener(config.liveEventName, (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (!payload || typeof payload.name !== 'string') return;

      const candidates = byMatchKey.get(normalise(payload.name)) ?? [];
      const byKind = (kind) => candidates.filter((edge) => edge.kind === kind);

      // Each relationship is judged on its own. A consumer edge matches on the
      // event alone, so folding it in with the others would let an unknown
      // producer find *something* and slip past the off-map count.
      const producers = byKind('produces').filter(
        (edge) => edge.producer === payload.producer,
      );
      const channels = byKind('publishes-to').filter(
        (edge) => edge.channel === payload.channel,
      );
      const consumers = byKind('consumed-by');

      // Reported separately, because "we have never heard of this producer" and
      // "we have never heard of this event" are different problems.
      const eventNode = config.eventNodes[normalise(payload.name)] ?? null;

      if (payload.producer && producers.length === 0) unknownProducers += 1;
      if (payload.channel && channels.length === 0) unknownChannels += 1;
      // Off-map means the event itself is unknown here. An event this catalog
      // declares is on the map whether or not anything is wired to it.
      if (!eventNode && candidates.length === 0) unmapped += 1;
      if (status) {
        const notes = [];
        if (unmapped) notes.push(unmapped + ' off-map');
        if (unknownProducers) notes.push(unknownProducers + ' unknown producer');
        if (unknownChannels) notes.push(unknownChannels + ' unknown channel');
        status.textContent = notes.length ? 'live · ' + notes.join(' · ') : 'live';
      }

      // A consumer edge still moves — the event fired and travelled toward that
      // consumer — but with a hollow marker, and it evidences nothing about the
      // consumer itself.
      for (const edge of [...producers, ...channels, ...consumers]) {
        promote(edge);
        edge.count += 1;
        send(edge);
      }

      // Only the endpoints this frame is actual evidence for. A producer's
      // telemetry says the event fired, on which channel, and from whom. It
      // says nothing about whether the consumer ran, so a consumer service node
      // never gains a count from it.
      const touched = new Set();

      // The event itself is evidenced by the frame existing, independently of
      // whether any producer or channel edge matched. A frame with no producer,
      // or one this map has never heard of, still proves the event occurred —
      // leaving its node grey at zero would be the map disbelieving something
      // it just watched happen.
      if (eventNode) touched.add(eventNode);

      for (const edge of producers) touched.add(edge.source);
      for (const edge of channels) touched.add(edge.target);
      for (const id of touched) bumpNode(id);
    });
  }
})();
</script>
</body>
</html>
`;
}
