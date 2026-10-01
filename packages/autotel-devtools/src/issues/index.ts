// `autotel-devtools/issues`: the one definition of what an issue is, shared by
// the devtools server, its widget, and autotel-mcp. Browser-safe.

export {
  normalizeMessage,
  culpritOf,
  appFrames,
  fingerprintOf,
  hashKey,
  type FingerprintInput,
} from './fingerprint';
export {
  occurrenceFromTrace,
  occurrenceFromLog,
  primaryException,
  type Occurrence,
  type IssueSource,
  type IssueSpanInput,
  type IssueLogInput,
  type Attributes as IssueAttributes,
} from './occurrence';
export {
  groupOccurrences,
  summarize,
  titleOf,
  type Issue,
  type IssueStatus,
  type GroupOptions,
} from './group';
export {
  firesOn,
  type Automation,
  type AutomationTrigger,
  type OccurrenceStep,
} from './automation';
export {
  buildRequest,
  deliver,
  issueBrief,
  redactDestination,
  type Destination,
  type DestinationType,
  type DeliveryResult,
  type IssuePayload,
  type OutgoingRequest,
  type SendTrigger,
} from './destinations';
