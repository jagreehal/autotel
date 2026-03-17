---
'autotel-terminal': patch
'autotel': patch
---

Fix snapshot recording mode and keyboard navigation

- Fix stale closure: add `recording` to useEffect dependency arrays for log and span listeners so snapshot mode actually activates
- Fix unreachable auto-stop: check record limit before truncating to maxSpans so recording auto-pauses at 200 events
- Fix keyboard navigation: add arrow-key handling for service-summary and errors views
