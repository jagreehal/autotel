---
name: autotel-nuxt
description: Nuxt module wiring Autotel Nitro adapters for server routes and API handlers.
---

# autotel-nuxt

Add `modules: ['autotel-nuxt']` to `nuxt.config.ts`, initialize `autotel` in a server plugin, and wrap API handlers with `withAutotelEventHandler` from `autotel-nuxt/runtime/nitro`.
