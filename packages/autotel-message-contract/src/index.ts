/**
 * autotel-contract — brokerless message contract testing.
 *
 * Pin the serialized shape of the messages your code sends and stores (events,
 * commands, queue payloads, HTTP bodies) and prove old and new versions stay
 * compatible — as ordinary unit tests, with the contract committed as a file
 * beside the test. No broker, no schema registry, nothing to run in Docker.
 *
 * @see {@link messageContract} for the snapshot + compatibility DSL.
 */
export {
  messageContract,
  ContractViolationError,
  approvedSnapshot,
} from './contract.js';
export type {
  ApprovedSnapshotSource,
  MessageContractOptions,
  GivenStep,
  WhenStep,
  SnapshotStep,
  CompatibilityStep,
} from './contract.js';

export {
  defaultSerializer,
  jsonSerializer,
} from './serializer.js';
export type {
  MessageSerializer,
  JsonSerializerOptions,
} from './serializer.js';

export { read } from './reader.js';
export type {
  Reader,
  ParseFn,
  StandardSchemaLike,
  ReadOutcome,
} from './reader.js';

export {
  isUpdateMode,
  resolveSnapshotPath,
  readSnapshot,
  writeSnapshot,
} from './snapshot-storage.js';
export type {
  SnapshotLocation,
  ReadSnapshotResult,
} from './snapshot-storage.js';

export { lineDiff } from './diff.js';
