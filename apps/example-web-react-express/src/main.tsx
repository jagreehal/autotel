import './telemetry';
import React, { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { api } from './http';

function Home() {
  useEffect(() => {
    const key = import.meta.env.VITE_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST,
      defaults: '2025-05-24',
      person_profiles: 'always',
    });
  }, []);
  const [out, setOut] = useState('');
  const [done, setDone] = useState(0);
  const run = async (call: () => Promise<{ data: unknown }>) => {
    try {
      setOut(JSON.stringify((await call()).data));
    } catch (error) {
      setOut(`error: ${(error as Error).message}`);
    } finally {
      setDone((n) => n + 1);
    }
  };
  return (
    <main>
      <button id="get" onClick={() => run(() => api.get('/clients/c1'))}>
        GET (axios/XHR)
      </button>
      <button
        id="post"
        onClick={() => run(() => api.post('/clients', { name: 'New' }))}
      >
        POST (axios/XHR)
      </button>
      <button
        id="fetch"
        onClick={() =>
          run(async () => ({
            data: await (
              await fetch(`${api.defaults.baseURL}/clients/c3`, {
                headers: { applicationToken: 'demo-token' },
              })
            ).json(),
          }))
        }
      >
        GET (fetch)
      </button>
      <pre id="out" data-done={done}>
        {out}
      </pre>
    </main>
  );
}

const router = createBrowserRouter([{ path: '/', element: <Home /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
