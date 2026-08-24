# @jagreehal/example-mcp-server

## 0.1.84

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0
  - autotel-mcp-instrumentation@51.0.0

## 0.1.83

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1
  - autotel-mcp-instrumentation@50.0.0

## 0.1.82

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0
  - autotel-mcp-instrumentation@50.0.0

## 0.1.81

### Patch Changes

- 31fd178: Support MCP `2026-07-28` (stateless) alongside the 2025-era protocol

  The protocol dropped the `initialize`/`initialized` handshake (SEP-2575) and the
  `Mcp-Session-Id` header (SEP-2567). One `instrumentMcpServer` /
  `instrumentMcpClient` call now covers both eras: the wrappers stay duck-typed
  Proxies, so era is detected per request and no SDK is imported at runtime.

  **Fixed: server spans were silently orphaned on the v2 SDK.** Neither era puts
  `_meta` in a handler's first argument — both SDKs validate `arguments` and hand
  the request metadata over on the context argument — but the v2 shape nests it at
  `ctx.mcpReq._meta` rather than v1's `extra._meta`. Every `2026-07-28` server span
  was starting a new trace instead of continuing the client's. The context is now
  located by shape rather than position, which also fixes resource handlers
  (`(uri, ctx)` and `(uri, variables, ctx)`).

  **Era-dependent attributes are read off the request instead of from config:**

  - `mcp.protocol.version` — from each request's
    `io.modelcontextprotocol/protocolVersion` envelope key on `2026-07-28`. There
    is no handshake left to pin it to.
  - `mcp.session.id` — from a 2025-era request (server) or `client.transport`
    (client). Absent on `2026-07-28`, which has no sessions.

  **Fixed: a handler with no input schema is called as `(ctx)` on both SDKs**, so
  treating `args[0]` as the arguments serialised the whole context. With
  `captureToolArgs: true` behind OAuth that put `http.authInfo.token` into
  `gen_ai.tool.call.arguments` and shipped it to the telemetry backend. The
  payload is now only read when the context was not found at that position.
  (Pre-existing; surfaced while adding the context lookup.)

  **Breaking:**

  - `MCP_METRICS.CLIENT_SESSION_DURATION` / `SERVER_SESSION_DURATION` and
    `MCP_METHODS.INITIALIZE` removed — nothing recorded them, and `2026-07-28` has
    nothing for them to measure.
  - `McpInstrumentationConfig.sessionId` is now a _fallback_, consulted only when
    the request carries no session of its own. Existing configs keep working; the
    value is simply outranked by the live one where there is one. It remains the
    only source for legacy stdio, whose transport has no session at all, and is
    ignored by sessionless 2026-07-28 requests.
  - Peer dependencies are now `@modelcontextprotocol/server` /
    `@modelcontextprotocol/client` ^2.0.0 **and** `@modelcontextprotocol/sdk`
    ^1.30.0, all optional. Install whichever you build against.

  **Added:**

  - `mcp.input_required` on the span and the duration metric when a `2026-07-28`
    handler returns `inputRequired(...)` instead of a result, so a multi-round-trip
    pause is not counted as completed work and the client's retry does not read as
    a duplicate call. The span status is left UNSET rather than OK — a pause is
    neither success nor failure. Detected with the SDK's own
    `resultType === 'input_required'` discriminator, so a result that legitimately
    carries a `requestState`/`inputRequests` field is not mistaken for a pause. The
    key is not under `mcp.tool.*` because `prompts/get` and `resources/read` can
    pause too, and a tool-namespaced label would split their duration series.
  - `MCP_METHODS.SERVER_DISCOVER`; the v2 client's `discover()` is traced as a
    discovery operation, in place of `initialize`.
  - Client wrappers forward trailing arguments verbatim, so v1's
    `callTool(params, resultSchema?, options?)` and v2's `callTool(params, options?)`
    both pass through untouched.

  **Examples migrated to 2026-07-28.** `example-mcp-server` now builds its server
  from a factory behind `serveStdio`, and `example-mcp-client` uses the v2 client
  with `versionNegotiation: 'auto'`. Both gained a `type-check` script — CI was
  not type-checking either app before.

  The server example also stopped writing spans to stdout. On a stdio MCP server
  stdout _is_ the protocol wire, so `ConsoleSpanExporter` corrupts it; the example
  now ships a small stderr exporter and says why.

- Updated dependencies [31fd178]
- Updated dependencies [31fd178]
  - autotel-mcp-instrumentation@49.0.0

## 0.1.80

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0
  - autotel-mcp-instrumentation@48.0.0

## 0.1.79

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1
  - autotel-mcp-instrumentation@47.0.0

## 0.1.78

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0
  - autotel-mcp-instrumentation@47.0.0

## 0.1.77

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0
  - autotel-mcp-instrumentation@46.0.0

## 0.1.76

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1
  - autotel-mcp-instrumentation@45.0.0

## 0.1.75

### Patch Changes

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0
  - autotel-mcp-instrumentation@45.0.0

## 0.1.74

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0
  - autotel-mcp-instrumentation@44.0.0

## 0.1.73

### Patch Changes

- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0
  - autotel-mcp-instrumentation@43.0.0

## 0.1.72

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0
  - autotel-mcp-instrumentation@42.0.0

## 0.1.71

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0
  - autotel-mcp-instrumentation@41.0.0

## 0.1.70

### Patch Changes

- Updated dependencies [3d9e31c]
  - autotel@4.2.5
  - autotel-mcp-instrumentation@40.0.1

## 0.1.69

### Patch Changes

- Updated dependencies [4b7ad78]
  - autotel@4.2.4
  - autotel-mcp-instrumentation@40.0.0

## 0.1.68

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3
  - autotel-mcp-instrumentation@40.0.0

## 0.1.67

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2
  - autotel-mcp-instrumentation@40.0.0

## 0.1.66

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1
  - autotel-mcp-instrumentation@40.0.0

## 0.1.65

### Patch Changes

- Updated dependencies [ec47ec8]
  - autotel@4.2.0
  - autotel-mcp-instrumentation@40.0.0

## 0.1.64

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel-mcp-instrumentation@39.0.0
  - autotel@4.1.0

## 0.1.63

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0
  - autotel-mcp-instrumentation@38.0.0

## 0.1.62

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0
  - autotel-mcp-instrumentation@37.0.0

## 0.1.61

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0
  - autotel-mcp-instrumentation@36.0.0

## 0.1.60

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0
  - autotel-mcp-instrumentation@35.0.0

## 0.1.59

### Patch Changes

- Updated dependencies [bb9a1b7]
  - autotel@3.4.2
  - autotel-mcp-instrumentation@34.0.0

## 0.1.58

### Patch Changes

- Updated dependencies [ea2cb4a]
  - autotel@3.4.1
  - autotel-mcp-instrumentation@34.0.0

## 0.1.57

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0
  - autotel-mcp-instrumentation@34.0.0

## 0.1.56

### Patch Changes

- Updated dependencies [4ce86fc]
  - autotel-mcp-instrumentation@33.0.1
  - autotel@3.3.1

## 0.1.55

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0
  - autotel-mcp-instrumentation@33.0.0

## 0.1.54

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0
  - autotel-mcp-instrumentation@32.0.0

## 0.1.53

### Patch Changes

- Updated dependencies [3966db0]
  - autotel@3.1.1
  - autotel-mcp-instrumentation@31.0.0

## 0.1.52

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0
  - autotel-mcp-instrumentation@31.0.0

## 0.1.51

### Patch Changes

- Updated dependencies [ee60622]
  - autotel@3.0.7
  - autotel-mcp-instrumentation@30.0.4

## 0.1.50

### Patch Changes

- Updated dependencies [8d5d84d]
  - autotel@3.0.6
  - autotel-mcp-instrumentation@30.0.4

## 0.1.49

### Patch Changes

- Updated dependencies [1a8bedd]
  - autotel-mcp-instrumentation@30.0.4
  - autotel@3.0.5

## 0.1.48

### Patch Changes

- Updated dependencies [3a21282]
  - autotel@3.0.4
  - autotel-mcp-instrumentation@30.0.3

## 0.1.47

### Patch Changes

- Updated dependencies [5e146a7]
  - autotel-mcp-instrumentation@30.0.3
  - autotel@3.0.3

## 0.1.46

### Patch Changes

- Updated dependencies [5999cb9]
  - autotel-mcp-instrumentation@30.0.2
  - autotel@3.0.2

## 0.1.45

### Patch Changes

- Updated dependencies [5d05a3e]
  - autotel-mcp-instrumentation@30.0.1
  - autotel@3.0.1

## 0.1.44

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0
  - autotel-mcp-instrumentation@30.0.0

## 0.1.43

### Patch Changes

- Updated dependencies [dc4908d]
  - autotel-mcp-instrumentation@29.0.1
  - autotel@2.26.3

## 0.1.42

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2
  - autotel-mcp-instrumentation@29.0.0

## 0.1.41

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1
  - autotel-mcp-instrumentation@29.0.0

## 0.1.40

### Patch Changes

- Updated dependencies [8003fad]
  - autotel@2.26.0
  - autotel-mcp@29.0.0

## 0.1.39

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5
  - autotel-mcp@28.0.2

## 0.1.38

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4
  - autotel-mcp@28.0.2

## 0.1.37

### Patch Changes

- Updated dependencies [3a5b723]
  - autotel@2.25.3
  - autotel-mcp@28.0.2

## 0.1.36

### Patch Changes

- Updated dependencies [7d77567]
  - autotel-mcp@28.0.2
  - autotel@2.25.2

## 0.1.35

### Patch Changes

- Updated dependencies [c6010e1]
  - autotel-mcp@28.0.1
  - autotel@2.25.1

## 0.1.34

### Patch Changes

- Updated dependencies [04c370a]
  - autotel-mcp@28.0.0
  - autotel@2.25.0

## 0.1.33

### Patch Changes

- Updated dependencies [3438fe4]
  - autotel@2.24.1
  - autotel-mcp@27.0.0

## 0.1.32

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0
  - autotel-mcp@27.0.0

## 0.1.31

### Patch Changes

- Updated dependencies [65b2fc9]
  - autotel-mcp@26.0.1
  - autotel@2.23.1

## 0.1.30

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0
  - autotel-mcp@26.0.0

## 0.1.29

### Patch Changes

- Updated dependencies [1155c72]
  - autotel-mcp@25.0.0
  - autotel@2.22.0

## 0.1.28

### Patch Changes

- Updated dependencies [c710c71]
  - autotel-mcp@24.0.0
  - autotel@2.21.0

## 0.1.27

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0
  - autotel-mcp@23.0.0

## 0.1.26

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel-mcp@22.0.0
  - autotel@2.19.0

## 0.1.25

### Patch Changes

- Updated dependencies [ecf920e]
  - autotel@2.18.1
  - autotel-mcp@21.1.0

## 0.1.24

### Patch Changes

- Updated dependencies [23ed022]
  - autotel@2.18.0
  - autotel-mcp@21.0.0

## 0.1.23

### Patch Changes

- Updated dependencies [e62eb75]
  - autotel@2.17.0
  - autotel-mcp@20.0.0

## 0.1.22

### Patch Changes

- Updated dependencies [8a6769a]
  - autotel@2.16.0
  - autotel-mcp@19.0.0

## 0.1.21

### Patch Changes

- Updated dependencies [c68a580]
  - autotel-mcp@18.0.0
  - autotel@2.15.0

## 0.1.20

### Patch Changes

- Updated dependencies [78202aa]
  - autotel@2.14.2
  - autotel-mcp@17.0.1

## 0.1.19

### Patch Changes

- Updated dependencies [acfd0de]
  - autotel@2.14.1
  - autotel-mcp@17.0.1

## 0.1.18

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel-mcp@17.0.0
  - autotel@2.14.0

## 0.1.17

### Patch Changes

- Updated dependencies [8256dac]
  - autotel-mcp@16.0.0
  - autotel@2.13.0

## 0.1.16

### Patch Changes

- Updated dependencies [3e12422]
  - autotel-mcp@15.0.1
  - autotel@2.12.1

## 0.1.15

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel-mcp@15.0.0
  - autotel@2.12.0

## 0.1.14

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0
  - autotel-mcp@14.0.0

## 0.1.13

### Patch Changes

- Updated dependencies [e5337b0]
  - autotel-mcp@13.0.0
  - autotel@2.10.0

## 0.1.13

### Patch Changes

- Updated dependencies [86ae1a8]
  - autotel-mcp@12.0.0
  - autotel@2.10.0

## 0.1.12

### Patch Changes

- Updated dependencies [05f2d95]
  - autotel@2.9.0
  - autotel-mcp@11.0.0

## 0.1.11

### Patch Changes

- Updated dependencies [e904227]
  - autotel-mcp@10.0.0
  - autotel@2.8.0

## 0.1.10

### Patch Changes

- Updated dependencies [bc0e668]
  - autotel@2.7.0
  - autotel-mcp@9.0.0

## 0.1.9

### Patch Changes

- Updated dependencies [2ae2ece]
  - autotel@2.6.0
  - autotel-mcp@8.0.0

## 0.1.8

### Patch Changes

- Updated dependencies [745ab4c]
  - autotel@2.5.0
  - autotel-mcp@7.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [31edf41]
  - autotel@2.4.0
  - autotel-mcp@6.0.0

## 0.1.6

### Patch Changes

- Updated dependencies [38f0462]
  - autotel@2.4.0
  - autotel-mcp@5.0.0

## 0.1.5

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel@2.3.0
  - autotel-mcp@4.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel@2.2.0
  - autotel-mcp@3.0.0
