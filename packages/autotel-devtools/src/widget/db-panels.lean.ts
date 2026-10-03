// Embedded build: the statement only, no plan diagnosis. The full viewer has it.
// Typed off the real module so a signature change fails tsc, not the build.
export const DbPlanDetail: typeof import('./db-panels').DbPlanDetail = null;
