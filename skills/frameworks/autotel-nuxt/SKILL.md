---
name: autotel-nuxt
description: >
  Use this skill when adding OpenTelemetry to a Nuxt app — the Nuxt module that wires Autotel's Nitro adapters into server routes and API handlers.
---

# autotel-nuxt

Add `modules: ['autotel-nuxt']` to `nuxt.config.ts`, initialize `autotel` in a server plugin, and wrap API handlers with `withAutotelEventHandler` from `autotel-nuxt/runtime/nitro`.
