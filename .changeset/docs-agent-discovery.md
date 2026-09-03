---
'autotel-docs': minor
---

Make the docs site discoverable by crawlers and coding agents.

`/robots.txt` states the crawl policy explicitly — every major AI crawler is
named, and Content-Signal (contentsignals.org) records that search, AI training
and AI inference are all welcome on these open-source docs. `/sitemap.xml`
aliases the sitemap index Starlight emits, which is the filename crawlers and
agent-readiness checks look for.

`/.well-known/agent-skills/index.json` lists the repo's Claude Code skills with
a `sha256:` digest per entry, and `/.well-known/agent-skills/<skill>/SKILL.md`
serves each one, so an agent can fetch the autotel instrumentation skills
straight from the docs site and verify what it got.
