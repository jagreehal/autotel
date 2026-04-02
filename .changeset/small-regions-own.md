---
'autotel-web': patch
---

fix(autotel-web): prevent exporter recursion, feature-detect sendBeacon, and resolve HTTP method from Request objects

- Use unpatched fetch reference in span exporter to avoid infinite loop when sendBeacon is unavailable
- Feature-detect `navigator.sendBeacon` before calling to prevent throws in environments without it
- Extract HTTP method from `Request` inputs so `fetch(new Request(url, { method: 'POST' }))` reports the correct method in spans
