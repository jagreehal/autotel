---
'autotel-subscribers': patch
---

Fix flaky Segment subscriber test by awaiting Segment initialization in the init test and ensuring assertions run after async setup.
