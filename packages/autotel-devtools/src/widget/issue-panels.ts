// Issue triage UI: per-issue actions (resolve, ignore, send) and the
// destinations/automations setup. The embedded widget swaps this module for
// `issue-panels.lean.ts`: it is a guest in someone else's page, so it shows
// issue status and leaves triage to the full viewer (`/`).
import Actions from './components/IssueActions.svelte';
import Automations from './components/IssueAutomations.svelte';

// Typed nullable so views handle the lean build's `null` without a cast.
export const IssueActions: typeof Actions | null = Actions;
export const IssueAutomations: typeof Automations | null = Automations;
