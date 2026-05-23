---
'autotel-subscribers': minor
---

Add `ArchitectureSnapshotSubscriber` — captures `track()` events into a
deterministic JSON snapshot describing what events your code emits, the
field paths inside their payloads, and (via the `_autotel.channel` /
`_autotel.producer` attribute convention) which service and channel each
event belongs to. The snapshot is the input to the forthcoming
`autotel-eventcatalog` generator and is designed to be committed alongside
your code so the catalog and the runtime can be diffed in PR review.

```typescript
import { init } from 'autotel';
import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture-snapshot';

const snapshot = new ArchitectureSnapshotSubscriber({ service: 'orders' });
init({ service: 'orders', subscribers: [snapshot] });
// ... exercise the system ...
await snapshot.writeToFile('./.autotel/snapshot.json');
```

The snapshot format is versioned (`autotel-architecture/v0.1.0`) and
deliberately small — existence + field-path drift only in v0. Type and value
drift are deferred to a later release.
