import './telemetry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
// Datadog's wrapper names each RUM view by its route. The /react-router-v7
// entry, not /react-router, which targets react-router 8.
import { createBrowserRouter } from '@datadog/browser-rum-react/react-router-v7';
import { identify, reportError, reportReactError } from './telemetry';
import { Layout, RouteError } from './pages/Layout';
import { Orders } from './pages/Orders';
import { Checkout } from './pages/Checkout';
import { Reports } from './pages/Reports';
import { Broken } from './pages/Broken';

identify({ id: 'usr_example', name: 'Example User' });

// A failed query or mutation is handled by TanStack, so nothing global sees it.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      reportError(error, { query: JSON.stringify(query.queryKey) }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) =>
      reportError(error, { mutation: mutation.options.mutationKey?.join('/') }),
  }),
  defaultOptions: { queries: { retry: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Orders /> },
      { path: '/checkout', element: <Checkout /> },
      { path: '/reports', element: <Reports /> },
      { path: '/broken', element: <Broken />, errorElement: <RouteError /> },
    ],
  },
]);

// React 19 reports errors through these, not window.onerror: one an error
// boundary caught is otherwise only a console.error.
createRoot(document.getElementById('root')!, {
  onCaughtError: reportReactError,
  onUncaughtError: reportReactError,
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
