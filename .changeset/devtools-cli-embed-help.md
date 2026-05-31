---
'autotel-devtools': patch
---

Clearer CLI startup banner for embedding the widget. The bundle auto-mounts on load, so the bare `<script src=".../widget.js"></script>` is all that's needed — the banner now says so explicitly (a floating panel appears automatically), and shows the two opt-in variations: `?mode=fullpage` for a full-screen view, or placing `<autotel-devtools></autotel-devtools>` yourself to control location. No behaviour change.
