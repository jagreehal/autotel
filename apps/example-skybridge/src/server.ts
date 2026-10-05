import { otelTrace } from 'autotel';
import { skybridgeTracing } from 'autotel-skybridge';
import { Skybridge } from 'skybridge/server';
import { z } from 'zod';

const FLIGHTS = [
  { id: 'BA117', from: 'LHR', to: 'JFK', price: 512 },
  { id: 'VS3', from: 'LHR', to: 'JFK', price: 468 },
  { id: 'AF22', from: 'CDG', to: 'JFK', price: 431 },
];

export const app = new Skybridge({
  name: 'example-skybridge',
  version: '0.0.0',
  handler: (server) =>
    server
      .registerTool(
        {
          name: 'search-flights',
          description: 'Search flights between two airports.',
          inputSchema: { from: z.string(), to: z.string() },
          annotations: { readOnlyHint: true },
          view: { component: 'flights', description: 'Flight results' },
        },
        async ({ from, to }) => {
          // Spans started inside a tool nest under its `tools/call` span.
          const flights = await otelTrace
            .getTracer('example-skybridge')
            .startActiveSpan('db.query flights', async (span) => {
              const rows = FLIGHTS.filter(
                (f) => f.from === from && f.to === to,
              );
              span.setAttribute('db.response.returned_rows', rows.length);
              span.end();
              return rows;
            });
          return {
            structuredContent: { flights },
            content: [
              { type: 'text', text: `${flights.length} flights found` },
            ],
          };
        },
      )
      .registerTool(
        {
          name: 'book-flight',
          description: 'Book a flight by id.',
          inputSchema: { id: z.string() },
        },
        async ({ id }) => {
          if (!FLIGHTS.some((f) => f.id === id)) {
            // Skybridge returns this as an isError result; the span keeps
            // the original exception and stack.
            throw new Error(`Unknown flight ${id}`);
          }
          return { content: [{ type: 'text', text: `Booked ${id}` }] };
        },
      )
      .mcpMiddleware(skybridgeTracing({ captureToolArgs: true })),
});

export type AppType = typeof app;
