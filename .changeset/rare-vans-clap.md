---
'autotel-cloudflare': patch
'autotel-drizzle': patch
'autotel-edge': patch
'autotel': patch
---

Clarify edge vs Node entry points and tighten Cloudflare logger packaging.

- **`autotel-cloudflare`**: Move `autotel-edge` to a required peer dependency (devDependency for this package’s tests) so Workers apps declare the edge foundation explicitly. Import execution-logger helpers from `autotel-edge/logger` instead of the root export. Document a logs-only quickstart via `autotel-cloudflare/logger`, a `nodejs_compat` compatibility matrix per subpath, and cross-links to related packages.
- **`autotel-edge`**: Re-export `TraceContext` from `autotel-edge/logger` for execution-logger consumers. Add See also links in the README.
- **`autotel-drizzle`**: Document Drizzle `>= 0.45.2` peer requirement, Node-only scope, and D1-on-Workers guidance via `autotel-cloudflare/bindings`. Add See also links.
- **`autotel`**: Add an entry-point map (Node vs Cloudflare vs edge) and See also links in the README.
