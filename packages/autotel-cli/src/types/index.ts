// Preset types
export type {
  EnvVar,
  Import,
  ConfigBlock,
  PackageRequirements,
  PresetType,
  OtlpProtocol,
  Preset,
  BackendPreset,
  SubscriberPreset,
  PluginPreset,
  PlatformPreset,
  QuickPreset,
  PresetRegistry,
} from './preset';

// Project types
export type {
  PackageManager,
  PackageJson,
  WorkspaceInfo,
  ProjectContext,
  InstrumentationFile,
  InstrumentationSection,
  ConfigDetection,
  GlobalOptions,
  InitOptions,
  DoctorOptions,
  AddOptions,
} from './project';

// Check types
export type {
  CheckLevel,
  CheckStatus,
  CheckFix,
  Check,
  CheckSummary,
  DoctorResult,
  CheckDefinition,
} from './check';
