---
'autotel-web': minor
---

`browser.web_vital` events carry attribution, so you can see why a vital is slow:

- `target`: the LCP element, largest layout shift or INP target.
- Phase durations in ms: TTFB, resource load delay and duration, render delay, input delay, processing, presentation, DNS, connection and request.
- For INP, the script responsible: `longest_script.function`, `.url`, `.invoker`, `.subpart` and `.duration`.
- `navigation_type`, `navigation_id`, `navigation_url`, `load_state` and `interaction_type`.

`attributeRedactor` applies to selectors and URLs. URLs export as http(s) only, without query or fragment, up to 1024 characters.

`initFull({ webVitals: { reportSoftNavs: true } })` reports vitals per SPA route change where the browser supports it.
