// Types for FacetFilter.svelte, kept in a plain .ts module so both `.ts`
// consumers (stories) and `.svelte` consumers can import them — a named type
// export from a `.svelte` file resolves under svelte-check but not plain `tsc`.

export interface FacetOption {
  value: string;
  /** Live count of matching items — shown as a trailing badge. */
  count: number;
}

export interface Facet {
  key: string;
  label: string;
  options: FacetOption[];
  /** Currently-selected values in this facet. */
  selected: Set<string>;
  onToggle: (value: string) => void;
}
