---
'autotel-eventcatalog': minor
---

Add `--base-snapshot` mode and a composite GitHub Action for PR drift checking.

`autotel-eventcatalog drift --base-snapshot <path> --snapshot <path> --catalog <path>`
reports only the drift the PR introduces, ignoring pre-existing drift. New
`compareDriftReports()` and `renderDeltaMarkdown()` library exports do the
same thing programmatically.

The new `action.yml` ships in the package so any repository can wire drift
checking into its PR pipeline with one step:

```yaml
- uses: jagreehal/autotel-eventcatalog@v0
  with:
    snapshot: ./services/test/snapshot.json
    catalog:  ./catalog
    base-ref: origin/${{ github.base_ref }}
    fail-on-drift: true
    comment-on-pr: true
```

The action runs the CLI, posts a sticky comment with the drift report on
the PR, and fails the check only when the PR introduces *new* drift.
