import { NavLink, Outlet, useRouteError } from 'react-router-dom';
import { errors, layers } from '../telemetry';

const nav = [
  ['/', 'Orders'],
  ['/checkout', 'Checkout'],
  ['/reports', 'Reports'],
  ['/broken', 'Broken widget'],
] as const;

export function Layout() {
  return (
    <div
      style={{ font: '16px/1.5 system-ui', maxWidth: 720, margin: '2rem auto' }}
    >
      <h1>Frontend errors in Datadog</h1>
      <p id="layers">
        Traces: <b>Datadog APM</b>. RUM: <b>{layers.rum ? 'on' : 'off'}</b>.
        PostHog: <b>{layers.posthog ? 'on' : 'off'}</b>. Errors: <b>{errors}</b>
        . Every error below reaches its tracker on the trace that explains it.
      </p>
      <nav style={{ display: 'flex', gap: '1rem' }}>
        {nav.map(([to, label]) => (
          <NavLink key={to} to={to} end>
            {label}
          </NavLink>
        ))}
      </nav>
      <p style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          id="throw"
          type="button"
          onClick={() => {
            throw new TypeError(
              'Cannot read properties of undefined (reading "royalties")',
            );
          }}
        >
          Throw in a click handler
        </button>
        <button
          id="reject"
          type="button"
          onClick={() => {
            void Promise.reject(new Error('Statement export timed out'));
          }}
        >
          Unhandled rejection
        </button>
      </p>
      <hr />
      <Outlet />
    </div>
  );
}

/** react-router's error boundary for a route that failed to render. */
export function RouteError() {
  const error = useRouteError();
  return (
    <div role="alert" id="route-error">
      <h2>Something went wrong</h2>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}
