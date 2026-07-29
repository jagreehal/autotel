# autotel-nuxt

## 2.0.0

### Patch Changes

- 756345d: Skills no longer ship inside the npm package tarballs. They now live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `contributing/`, as a single source of truth discovered by the skills CLI (`npx skills add jagreehal/autotel --skill <name>`). `skills` is removed from each package's `files` field, so installing a package no longer adds its skill to `node_modules`. Install skills explicitly with the CLI instead.
- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0
  - autotel-adapters@2.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0
  - autotel-adapters@2.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [100cfad]
  - autotel-adapters@1.0.0
