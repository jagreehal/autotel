export type {
  InstrumentMongooseConfig,
  SerializerPayload,
  CustomMethodsConfig,
  CustomMethodType,
  MethodSelector,
  ParameterCaptureConfig,
} from './types';

export { instrumentMongoose } from './instrumentation';

export { watchTransitions } from './watch-transitions';
export type {
  TransitionChange,
  TransitionChangeStream,
  TransitionWatcher,
  WatchableCollection,
  WatchedTransition,
  WatchTransitionsOptions,
} from './watch-transitions';
