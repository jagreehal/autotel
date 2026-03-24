# AI View with json-render Design

## Goal

Replace the narrow AI sidebar with a full-width AI view (`A` key) that uses `@json-render/ink` to render rich terminal UI (tables, charts, badges) from AI tool calls.

## Architecture

The AI gets a new `render_ui` tool that accepts json-render specs. When the AI wants to show structured data (span tables, service stats, latency charts), it calls `render_ui` with a spec. The spec is rendered using `@json-render/ink`'s `Renderer` component. Plain text responses render as before.

## Components

### AI View (`A` key toggle)

Full-width view replacing the sidebar. Layout:

```
┌──────────────────────────────────────────────────┐
│ AI Assistant                      (streaming...) │
├──────────────────────────────────────────────────┤
│ > what are the slowest services?                 │
│                                                  │
│ Based on the telemetry data, here are the        │
│ slowest services by p95 latency:                 │
│                                                  │
│ ┌─────────────────────────────────────────────┐  │
│ │ Service Performance                         │  │
│ ├────────────┬────────┬───────┬──────────────┤  │
│ │ Service    │ Spans  │ Errs  │ p95          │  │
│ ├────────────┼────────┼───────┼──────────────┤  │
│ │ api        │ 120    │ 3     │ 450ms        │  │
│ │ worker     │ 80     │ 0     │ 320ms        │  │
│ │ postgres   │ 45     │ 1     │ 50ms         │  │
│ └────────────┴────────┴───────┴──────────────┘  │
│                                                  │
│ The api service is the bottleneck with a p95 of  │
│ 450ms and 3 errors.                              │
├──────────────────────────────────────────────────┤
│ > _                                              │
└──────────────────────────────────────────────────┘
```

### `render_ui` tool

New tool added to `ai/tools.ts`:

- Parameter: `spec` — a json-render spec object (`{ root, elements }`)
- The AI calls it when it wants to display tables, charts, or structured data
- Latest spec is stored in `aiSpec` state and rendered below the chat
- Multiple calls in one response: latest wins

### Component catalog (minimal)

9 components from `@json-render/ink`:

| Component | Use case |
|-----------|----------|
| `Table` | Span lists, service stats, error summaries |
| `KeyValue` | Span attributes, trace details |
| `Badge` | Status (OK/ERROR), severity (INFO/WARN) |
| `BarChart` | Latency distribution, service comparison |
| `Text` | Inline text, descriptions |
| `Box` | Layout container |
| `Heading` | Section titles |
| `Divider` | Section separators |
| `Card` | Grouping related content |

### System prompt update

Add to the existing system prompt:

- Description of `render_ui` tool and when to use it
- Available components and their props (generated from catalog)
- Guidelines: use `render_ui` for tables/comparisons/structured data, plain text for explanations

### Migration from sidebar

Remove:
- `aiShowPanel` state and `a` key toggle
- Sidebar rendering in the two-column layout
- AI input handling from the sidebar

Add:
- `'ai'` to `ViewMode` type
- `A` key handler in `dashboard-keymap.ts`
- Full-width AI view in `index.tsx`
- AI input handling in the full-width view

## Data flow

```
User types question
  → sendAIQuery()
  → AI streams text chunks (update message state)
  → AI calls render_ui tool (store spec in aiSpec state)
  → AI view renders:
      - Chat history (plain Text components)
      - Rich output (json-render Renderer with latest spec)
      - Input bar at bottom
```

## Dependencies

- `@json-render/ink` — Ink renderer + standard components
- `@json-render/core` — Catalog definition + spec types

## Scope

- Full-width AI view with `A` key toggle
- `render_ui` tool with 9-component catalog
- System prompt update with catalog description
- Remove sidebar AI panel
- Keep existing AI tools (getOverviewStats, listServices, etc.)
