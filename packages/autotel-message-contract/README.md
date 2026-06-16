# autotel-message-contract

> Pin the serialized shape of your messages and prove old and new versions stay compatible, as ordinary unit tests with the contract committed beside the test.

`autotel-message-contract` is contract testing for the messages your code sends and stores: events, commands, queue payloads, HTTP request/response bodies, and anything else you serialize for someone else to read.

You write a small unit test that locks down a message's serialized format. Later you rename a field or change a type. The code still compiles and your other tests pass, but this one fails and points at what changed. You fix it in the same pull request, before a consumer or a stored event has hit the old format in production.

It is the test-time companion to [`autotel-pact`](../autotel-pact) (runtime evidence that contracted interactions actually fired) and [`autotel-schema`](../autotel-schema) (your telemetry surface as a contract). Where those answer *did it run?* and *is my trace surface stable?*, this answers *does my message serialization stay stable and stay compatible across versions?*

## Why

When you change how a message serializes, the change is easy to miss. The code compiles and the tests pass, because they write and read the message with the same code. The mismatch surfaces later, when something holding the old format reads it: a stored event, a message waiting on a queue, or another service.

`autotel-message-contract` takes the small, brokerless approach:

- **The checks are ordinary unit tests** in your existing suite, with no broker, schema registry, or mock service to run, and nothing to start in Docker.
- **The contract is the serialized output committed next to the test**, so a format change appears in a normal diff and is reviewed like any other code.
- **The check uses your application's own serializer**, so the snapshot is the exact bytes you ship.

It checks the serialized shape of a message and whether its versions stay compatible. It doesn't exercise a live exchange between running services, so it complements that kind of tooling (Pact, `autotel-pact`) rather than replacing it.

## Install

```bash
pnpm add -D autotel-message-contract
# autotel is an optional peer dependency; this package works standalone
```

## Snapshot check: pin the serialized shape

A snapshot check confirms a message still serializes to the bytes you approved, so nothing reading it downstream breaks. The first run writes the approved file and passes; you review and commit it. From then on the check compares against it.

```ts
import { messageContract } from 'autotel-message-contract';
import { OrderPlaced } from './events';

it('OrderPlaced serialization is unchanged', () => {
  messageContract({ snapshot: 'OrderPlaced' })
    .given(new OrderPlaced('ord-1', 'Alice', placedAt))
    .whenSerialized()
    .thenContractIsUnchanged();
});
```

The approved file lands in a `__contracts__/` directory beside the test (`OrderPlaced.approved.txt`). When the format drifts, the failure shows you what moved:

```
Message contract drifted from its approved snapshot.
  serializer: json
  snapshot:   .../__contracts__/OrderPlaced.approved.txt

  {
-   "customer": "Alice",
+   "customerName": "Alice",
    "orderId": "ord-1"
  }

If this change is intentional, re-run with AUTOTEL_CONTRACT_UPDATE=1 to update the
approved file, then review and commit it.
```

### Use your application's serializer

The default serializer is JSON with deterministic key ordering, good enough to pin most events. The snapshot is only meaningful if it matches the shape your consumers see. Pass your app's real serializer so the snapshot records the exact bytes you ship (snake_case, custom date formats, omitted nulls, `superjson`, `devalue`, protobuf):

```ts
import { messageContract } from 'autotel-message-contract';

messageContract({ serializer: mySnakeCaseSerializer, snapshot: 'OrderPlaced' })
  .given(new OrderPlaced('ord-1', 'Alice', placedAt))
  .whenSerialized()
  .thenContractIsUnchanged();
```

A `MessageSerializer` is `{ name, serialize, deserialize }`. `jsonSerializer({ indent: 0, sortKeys: false })` gives you the compact, order-preserving bytes you put on the wire.

## Compatibility check: prove versions still read each other

A compatibility check is for the version you evolve on purpose, so changing a message doesn't strand the ones already in your store or on the wire. TypeScript erases types at runtime, so instead of a class you hand over a **reader**: a [Standard Schema](https://standardschema.dev) (Zod ≥3.24, Valibot, ArkType) or a plain parse function.

**Backward compatible**: confirm a newer reader still reads what an older writer produced (events you stored last year, a request already sent):

```ts
import { messageContract } from 'autotel-message-contract';
import { OrderPlacedV2 } from './events'; // a Zod schema

await messageContract()
  .given(orderPlacedV1) // bytes an old version wrote
  .whenDeserializedAs(OrderPlacedV2)
  .thenBackwardCompatible((v2) => {
    expect(v2.coupon).toBeUndefined(); // newly-added field defaults sensibly
  });
```

**Forward compatible**: confirm a consumer that hasn't upgraded yet still reads what the newer writer produces, so you can ship the new shape before the readers have caught up:

```ts
await messageContract()
  .given(orderPlacedV2) // bytes the new version writes
  .whenDeserializedAs(OrderPlacedV1)
  .thenForwardCompatible();
```

Compatibility checks are stricter than simple parse-success: after the target
reader accepts the payload, the package re-serializes the parsed value and
checks that shared fields still mean the same thing. Silent field renames or
lossy transforms fail even if the reader does not throw.

### Replay a saved snapshot as the source version

When you want to prove that today's reader still accepts a payload you approved
months ago, point the check at the approved file directly:

```ts
import { approvedSnapshot, messageContract } from 'autotel-message-contract';

await messageContract({ snapshot: 'OrderPlaced_v1' })
  .given(approvedSnapshot())
  .whenDeserializedAs(OrderPlacedV2)
  .thenBackwardCompatible();
```

You can also pass an explicit location: `approvedSnapshot({ dir, name })` or
`approvedSnapshot({ path })`.

When the versions have drifted apart, the failure names the issues:

```
Not backward-compatible: the newer reader rejected a message an older writer produced.
  serializer: json
  serialized: {"customerName":"Alice","orderId":"ord-1"}
  issues:
    - customer: Required
```

## Updating snapshots

When a change is intentional, re-run with any of these set, review the diff, and commit:

```bash
AUTOTEL_CONTRACT_UPDATE=1 pnpm test
# UPDATE_CONTRACTS / UPDATE_SNAPSHOTS also work
```

Or per-check: `messageContract({ snapshot: 'X', update: true })`.

## What this package does NOT do

- **Does not replace Pact / `autotel-pact`.** It checks serialized shape and version compatibility, not a live exchange between running services.
- **Does not infer your serializer.** Pass your app's serializer to pin the bytes you ship; the default is deterministic JSON.
- **Does not pin API/type surface.** Single-purpose by design. For module or type-surface pinning use a dedicated tool like [`@microsoft/api-extractor`](https://api-extractor.com) or [`@arethetypeswrong/cli`](https://github.com/arethetypeswrong/arethetypeswrong.github.io).

## API

| Export | Purpose |
|--------|---------|
| `messageContract(options?)` | Start a check: `.given(msg).whenSerialized()` / `.whenDeserializedAs(reader)`. |
| `approvedSnapshot(location?)` | Use a committed approved file as the source version in a compatibility check. |
| `jsonSerializer(options?)` | Deterministic JSON serializer; `defaultSerializer` is `jsonSerializer()`. |
| `read(reader, value)` | Run a reader (schema or parse fn) against a value; never throws. |
| `lineDiff`, `resolveSnapshotPath`, `readSnapshot`, `writeSnapshot`, `isUpdateMode` | Lower-level building blocks. |

## License

MIT © Jag Reehal
