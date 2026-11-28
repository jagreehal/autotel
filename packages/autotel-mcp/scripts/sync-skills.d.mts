import type { PublishedSkill } from '../src/modules/skills';

/** The skills/ paths this server publishes. */
export declare const PUBLISHED: readonly string[];
/** The catalog as the repository's skills/ directory holds it now. */
export declare function buildCatalog(): PublishedSkill[];
export declare function renderCatalog(catalog: PublishedSkill[]): string;
