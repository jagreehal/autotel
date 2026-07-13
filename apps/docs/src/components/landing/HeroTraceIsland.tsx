import { useEffect, useRef, useState } from 'preact/hooks';
import './hero-trace-island.css';

type SpanRow = {
  name: string;
  start: number;
  width: number;
  ms: string;
  depth: 0 | 1;
  kind: 'root' | 'child' | 'error';
};

type Field = { key: string; value: string; accent?: boolean };

type Scene = {
  id: string;
  /** Uppercase label shown in the trace header, e.g. the route. */
  route: string;
  traceId: string;
  total: string;
  spans: SpanRow[];
  snapTitle: string;
  snapshot: Field[];
};

/**
 * Three real autotel shapes rotate on a calm loop: a healthy HTTP request, a
 * failed charge, and an LLM call with cost. Each plays its waterfall, then
 * collapses to the single wide event autotel emits — the product story on repeat.
 */
const SCENES: Scene[] = [
  {
    id: 'http',
    route: 'POST /checkout',
    traceId: 'b5e1·c0ff·ee42',
    total: '124ms',
    spans: [
      { name: 'POST /checkout', start: 0, width: 100, ms: '124ms', depth: 0, kind: 'root' },
      { name: 'auth.verify', start: 4, width: 14, ms: '18ms', depth: 1, kind: 'child' },
      { name: 'db.query', start: 20, width: 38, ms: '47ms', depth: 1, kind: 'child' },
      { name: 'stripe.charge', start: 60, width: 34, ms: '42ms', depth: 1, kind: 'child' },
    ],
    snapTitle: 'getRequestLogger → emitNow',
    snapshot: [
      { key: 'http.route', value: '/checkout' },
      { key: 'http.status', value: '200' },
      { key: 'user.plan', value: 'pro' },
      { key: 'db.rows', value: '3' },
      { key: 'duration_ms', value: '124' },
    ],
  },
  {
    id: 'error',
    route: 'POST /checkout',
    traceId: '9f3a·17bd·0e10',
    total: '138ms',
    spans: [
      { name: 'POST /checkout', start: 0, width: 100, ms: '138ms', depth: 0, kind: 'root' },
      { name: 'auth.verify', start: 4, width: 13, ms: '18ms', depth: 1, kind: 'child' },
      { name: 'db.query', start: 19, width: 34, ms: '45ms', depth: 1, kind: 'child' },
      { name: 'stripe.charge', start: 56, width: 40, ms: '52ms', depth: 1, kind: 'error' },
    ],
    snapTitle: 'error recorded → emitNow',
    snapshot: [
      { key: 'http.route', value: '/checkout' },
      { key: 'http.status', value: '500', accent: true },
      { key: 'error.code', value: 'card_declined', accent: true },
      { key: 'stripe.charge', value: 'failed' },
      { key: 'duration_ms', value: '138' },
    ],
  },
  {
    id: 'genai',
    route: 'POST /chat',
    traceId: 'a1c4·88fe·2b90',
    total: '2.10s',
    spans: [
      { name: 'POST /chat', start: 0, width: 100, ms: '2.1s', depth: 0, kind: 'root' },
      { name: 'retrieve.context', start: 3, width: 12, ms: '240ms', depth: 1, kind: 'child' },
      { name: 'gen_ai.chat', start: 17, width: 74, ms: '1.6s', depth: 1, kind: 'child' },
      { name: 'tool.get_order', start: 92, width: 7, ms: '150ms', depth: 1, kind: 'child' },
    ],
    snapTitle: 'gen_ai span → emitNow',
    snapshot: [
      { key: 'gen_ai.model', value: 'gpt-4o' },
      { key: 'input_tokens', value: '1,204' },
      { key: 'output_tokens', value: '318' },
      { key: 'cost_usd', value: '$0.0089', accent: true },
      { key: 'duration_ms', value: '2100' },
    ],
  },
];

const LIVE_MS = 3200;
const SNAP_MS = 2600;

export default function HeroTraceIsland() {
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  /** dormant = before scroll-in; live = waterfall; snapshot = collapsed wide event */
  const [phase, setPhase] = useState<'dormant' | 'live' | 'snapshot'>('dormant');
  const [sceneIdx, setSceneIdx] = useState(0);
  /** Remount span rows so bar keyframes restart each time a scene goes live. */
  const [animKey, setAnimKey] = useState(0);
  /** Hover/focus pauses the loop so a reader can dwell on a scene. */
  const [paused, setPaused] = useState(false);

  const scene = SCENES[sceneIdx]!;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const el = rootRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        started.current = true;
        setPhase(mq.matches ? 'snapshot' : 'live');
      },
      { threshold: 0.22, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The calm loop: live → snapshot → next scene → live. Reduced motion holds
  // on a static snapshot and never advances.
  useEffect(() => {
    if (phase === 'dormant' || paused || reduceMotion) return;
    if (phase === 'live') {
      const t = window.setTimeout(() => setPhase('snapshot'), LIVE_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      setSceneIdx((i) => (i + 1) % SCENES.length);
      setAnimKey((k) => k + 1);
      setPhase('live');
    }, SNAP_MS);
    return () => window.clearTimeout(t);
  }, [phase, paused, reduceMotion, sceneIdx]);

  const jump = (i: number) => {
    if (i === sceneIdx && phase !== 'snapshot') return;
    setSceneIdx(i);
    setAnimKey((k) => k + 1);
    setPhase(reduceMotion ? 'snapshot' : 'live');
  };

  const cold = phase === 'dormant' && !reduceMotion;
  const showSnap = phase === 'snapshot';

  return (
    <div
      ref={rootRef}
      class={`hti not-content${reduceMotion ? ' hti--reduce' : ''}${cold ? ' hti--cold' : ''}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div class="hti__head">
        <span class="hti__label">trace</span>
        <span class="hti__route">{scene.route}</span>
        <span class="hti__total">{scene.total}</span>
        <span
          class={`hti__pill ${showSnap ? 'hti__pill--snap' : 'hti__pill--live'}`}
          aria-live="polite"
        >
          {phase === 'dormant' ? '…' : showSnap ? 'wide event' : 'live'}
        </span>
      </div>

      <div class="hti__stage">
        {!showSnap ? (
          <ol key={animKey} class="hti__list" aria-label={`Spans for ${scene.route}`}>
            {scene.spans.map((s) => (
              <li
                key={s.name}
                class={`hti__row${s.depth === 1 ? ' hti__row--child' : ''}${
                  s.kind === 'error' ? ' hti__row--error' : ''
                }${s.kind === 'root' ? ' hti__row--root' : ''}`}
              >
                <span class="hti__name">
                  {s.depth === 1 ? (
                    <span class="hti__branch" aria-hidden="true">
                      └─
                    </span>
                  ) : null}
                  {s.name}
                </span>
                <span class="hti__track">
                  <span
                    class="hti__bar"
                    style={`--bar-start:${s.start}%;--bar-width:${s.width}%`}
                  />
                </span>
                <span class="hti__ms">{s.ms}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div class="hti__snapshot" aria-label={`Wide event for ${scene.route}`}>
            <p class="hti__snap-title">{scene.snapTitle}</p>
            {scene.snapshot.map((row) => (
              <div key={row.key} class="hti__field">
                <span class="hti__key">{row.key}</span>
                <span class={`hti__val${row.accent ? ' hti__val--accent' : ''}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="hti__foot">
        <div class="hti__tabs" role="tablist" aria-label="Trace scenarios">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === sceneIdx}
              aria-label={s.id}
              class={`hti__tab${i === sceneIdx ? ' hti__tab--on' : ''}`}
              onClick={() => jump(i)}
            >
              {s.id}
            </button>
          ))}
        </div>
        <span class="hti__hint" aria-hidden="true">
          spans → one wide event
        </span>
      </div>
    </div>
  );
}
