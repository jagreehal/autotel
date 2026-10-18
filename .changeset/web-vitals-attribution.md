---
'autotel-web': minor
'autotel-devtools': patch
---

**autotel-web:** `browser.web_vital` events carry attribution, so you can see why a vital is slow:

- `target`: the LCP element, largest layout shift or INP target.
- Phase durations in ms: TTFB, resource load delay and duration, render delay, input delay, processing, presentation, DNS, connection and request.
- For INP, the script responsible: `longest_script.function`, `.url`, `.invoker`, `.subpart` and `.duration`.
- `navigation_type`, `navigation_id`, `navigation_url`, `load_state` and `interaction_type`.

`attributeRedactor` applies to selectors and URLs. URLs export as http(s) origin and path only, up to 1024 characters. `initFull({ webVitals: { reportSoftNavs: true } })` reports vitals per SPA route change where the browser supports it.

**autotel-devtools:**

- Traces list their logs under the waterfall, read from the store and the live tail. Click a line to select its span.
- Histograms sum every series and count each observation once per window. Legend rows show each series' observation count; click one to isolate it.
- The service map connects services that call each other without CLIENT/SERVER span kinds.
- `q=` in a shared URL fills the trace search on load.
- The sidebar connection status wraps to the sidebar's width.
- The viewer's tab icon is a telescope, legible at 16px on light and dark tabs.
