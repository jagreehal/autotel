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

const SPANS: SpanRow[] = [
  { name: 'POST /checkout', start: 0, width: 100, ms: '124ms', depth: 0, kind: 'root' },
  { name: 'auth.verify', start: 4, width: 14, ms: '18ms', depth: 1, kind: 'child' },
  { name: 'db.query', start: 20, width: 38, ms: '47ms', depth: 1, kind: 'child' },
  { name: 'stripe.charge', start: 60, width: 38, ms: '52ms', depth: 1, kind: 'error' },
];

const SNAPSHOT: { key: string; value: string }[] = [
  { key: 'traceId', value: 'b5e1c0ffee42' },
  { key: 'path', value: '/checkout' },
  { key: 'stripe.charge.status', value: '500' },
  { key: 'error.code', value: 'card_declined' },
  { key: 'emitNow', value: 'true — one correlated log line' },
];

export default function HeroTraceIsland() {
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  /** Remount span rows so bar keyframes restart on each replay. */
  const [animKey, setAnimKey] = useState(0);
  /** dormant = before scroll-in; live = waterfall; snapshot = request logger snapshot */
  const [phase, setPhase] = useState<'dormant' | 'live' | 'snapshot'>('dormant');

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
      { threshold: 0.22, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = window.setTimeout(() => setPhase('snapshot'), 5200);
    return () => clearTimeout(t);
  }, [phase]);

  const showSnapshot = () => setPhase('snapshot');

  const replay = () => {
    setAnimKey((k) => k + 1);
    setPhase('live');
  };

  const cold = phase === 'dormant' && !reduceMotion;

  return (
    <div
      ref={rootRef}
      class={`hti not-content${reduceMotion ? ' hti--reduce' : ''}${cold ? ' hti--cold' : ''}`}
    >
      <div class="hti__head">
        <span class="hti__label">trace</span>
        <span class="hti__id">b5e1·c0ff·ee42</span>
        <span class="hti__total">total 124ms</span>
        <span
          class={`hti__pill ${phase === 'snapshot' ? 'hti__pill--snap' : 'hti__pill--live'}`}
          aria-live="polite"
        >
          {phase === 'snapshot' ? 'snapshot' : phase === 'live' ? 'live' : '…'}
        </span>
      </div>

      {phase !== 'snapshot' ? (
        <>
          <ol key={animKey} class="hti__list" aria-label="Example spans">
            {SPANS.map((s) => (
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
          {phase === 'live' ? (
            <div class="hti__footer">
              <button type="button" class="hti__btn hti__btn--primary" onClick={showSnapshot}>
                View request snapshot
              </button>
              <span class="hti__hint">or wait — auto-collapses like a wide event</span>
            </div>
          ) : null}
        </>
      ) : (
        <div class="hti__snapshot" aria-label="Request logger snapshot">
          <p class="hti__snap-title">getRequestLogger → emitNow</p>
          {SNAPSHOT.map((row) => (
            <div key={row.key} class="hti__field">
              <span class="hti__key">{row.key}</span>
              <span class="hti__val">{row.value}</span>
            </div>
          ))}
          <div class="hti__footer">
            <button type="button" class="hti__btn" onClick={replay}>
              Replay trace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
