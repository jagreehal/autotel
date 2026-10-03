// Query-plan detail under a database span's statement. The embedded widget
// swaps this module for `db-panels.lean.ts`: it shows the statement and leaves
// plan diagnosis to the full viewer (`/`), inside its size budget.
import Panel from './components/DbPlanDetail.svelte';

// Typed nullable so views handle the lean build's `null` without a cast.
export const DbPlanDetail: typeof Panel | null = Panel;
