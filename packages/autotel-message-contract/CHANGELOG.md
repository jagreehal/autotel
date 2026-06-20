# autotel-message-contract

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-message-contract`**, brokerless message contract testing. An
  optional, standalone, test-time package adjacent to autotel's
  observability-contract pair (`autotel-schema`, the telemetry contract you emit;
  `autotel-pact`, evidence that contracted interactions actually ran). It extends
  the idea beyond telemetry to serialized payload compatibility across versions,
  and needs no runtime observability to be useful (`autotel` is an optional peer).

  Pin the serialized shape of the messages your code sends and stores (events,
  commands, queue payloads, HTTP bodies) and prove old and new versions stay
  compatible, as ordinary unit tests with the contract committed as an approved
  file beside the test. No broker, no schema registry, nothing to run in Docker.
  - `messageContract().given(msg).whenSerialized().thenContractIsUnchanged()`:
    snapshot the serialized output using your app's own serializer; fail with a
    diff when the shape drifts. Update with `AUTOTEL_CONTRACT_UPDATE=1`.
  - `.whenDeserializedAs(reader).thenBackwardCompatible()` / `.thenForwardCompatible()`:
    prove a newer reader still reads older bytes, and a reader is a
    Standard Schema (Zod/Valibot/ArkType) or a plain parse function.
  - `autotel-message-contract/serializer`: the `MessageSerializer` interface and a
    deterministic `jsonSerializer`; pass your own to pin the exact bytes you ship.

  The package covers message serialization only. For type or API surface pinning,
  use a dedicated tool like api-extractor.
