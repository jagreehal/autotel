---
'autotel-devtools': minor
---

Span inspection: code-location links, database query view, and inline span events.

- **Code-location linking**: when a span carries `code.*` attributes (both the legacy `code.filepath`/`code.lineno` and current `code.file.path`/`code.line.number` conventions), the span detail panel renders a clickable editor deep-link. The target editor (VS Code / Cursor / WebStorm) is selectable and persisted across sessions.
- **Database query inspection**: spans with `db.*` attributes get a dedicated panel showing system, operation, table, database name, and row counts, plus the SQL statement with display-only keyword/string highlighting. Highlighting only tokenises — it never reformats or rewrites the query.
- **Inline span-event popover**: waterfall event markers are now clickable, opening an inline popover with the event name, timestamp, severity, and attributes. Dismissed on outside click or Escape. The marker lane-packing logic was extracted into a tested pure module.
