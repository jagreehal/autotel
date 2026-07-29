---
name: autotel-message-contract
description: >
  Use this skill when pinning the serialized shape of events, commands, or queue payloads as ordinary unit tests — messageContract() snapshot checks with a committed approved file, version-compatibility checks across old and new message versions, or wiring your app's real serializer (snake_case, superjson, protobuf) so the snapshot matches the bytes you ship.
---

# autotel-message-contract

Contract testing for the messages your code serializes for someone else to read: events, commands, queue payloads, HTTP bodies. You rename a field; the code still compiles and your other tests pass, because they write and read with the same code. This one test fails and points at what changed, so you fix it in the same pull request — before a stored event or a queued message hits the old format in production.

Brokerless by design: the checks are ordinary unit tests, the contract is the serialized output committed beside the test, and the check runs your application's own serializer. Nothing to start in Docker.

## When to use

- Lock the serialized shape of a message so downstream readers don't break.
- Prove old and new versions of a message stay compatible.
- Record the exact bytes you ship by using your real serializer.

## Core patterns

### Pin the serialized shape

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

The first run writes `__contracts__/OrderPlaced.approved.txt` beside the test and passes; review and commit it. Later drift shows a diff and tells you to re-run with `AUTOTEL_CONTRACT_UPDATE=1` once the change is intentional.

### Use your application's serializer

The default is JSON with deterministic key ordering. The snapshot only means something if it matches what consumers see, so pass your real serializer for snake_case, custom dates, omitted nulls, `superjson`, `devalue`, or protobuf.

```ts
messageContract({ serializer: mySnakeCaseSerializer, snapshot: 'OrderPlaced' });
```

## Common mistakes

### HIGH: Snapshotting with JSON when you ship something else

A JSON snapshot won't catch a break in a snake_case or protobuf payload your consumers actually read. Pass the serializer you ship.

### MEDIUM: Committing an approved file without reading the diff

`AUTOTEL_CONTRACT_UPDATE=1` overwrites the approved file. Review the diff first; an unreviewed update defeats the check.

## Related

- `autotel-pact` — runtime evidence that contracted interactions fired.
- `autotel-schema` — the same contract idea for your telemetry surface.

## Version

Install as a dev dependency. `autotel` is an optional peer; this package works standalone.
