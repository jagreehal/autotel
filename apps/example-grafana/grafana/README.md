# `grafana/` — this service's dashboards and alarms

Everything in this folder is owned by the team that owns the code next to it.
An alarm is a piece of the service, not a thing that lives in someone else's
console: it has a threshold that only the people who wrote the code can defend,
a runbook that goes stale the moment the code changes, and a blast radius when
it is wrong. So it is reviewed in the same pull request as the change that
moves it.

```
grafana/
├── dashboards/carrier-gateway.json   what we look at
├── provisioning/alerting.yml         what pages us, at what threshold, routed where
├── provisioning/dashboards.yml       where Grafana should look for the above
└── lgtm.overlay.yml                  run it all locally before it reaches prod
```

## What this buys you

- **The threshold is reviewable.** `0.05` sits in a diff with the change that
  made someone want to move it. "Why is this 5%?" is answered by `git log`.
- **You can run the alarm before you ship it.** `lgtm.overlay.yml` starts the
  same rules against a local stack. Alarms that have never fired in anger are
  guesses.
- **Drift is a merge conflict, not a mystery.** Provisioned dashboards are
  read-only in the UI, so the 3am edit that fixed everything either lands in
  the repo or does not survive.
- **Deleting the service deletes its alarms.** Nobody inherits a page for code
  that no longer exists.

The cost is real and worth naming: JSON dashboards are unpleasant to hand-edit.
Two workflows make that survivable — build it in Grafana's UI, export the JSON,
commit that; or let an agent write the files (see below). Either way what you
give up is edit-in-place, and what you get back is review, history and
reproducibility.

## Writing this folder with an agent

Grafana ships an [MCP server](https://grafana.com/docs/grafana/latest/developer-resources/mcp/)
and a [skills marketplace](https://github.com/grafana/skills), which between
them remove the "nobody on the team knows Grafana's JSON" objection:

```bash
claude plugin marketplace add grafana/skills
claude plugin install grafana-core@grafana-skills   # dashboarding, alerting-irm, promql
```

The rule that keeps this from recreating the problem it solves: **read through
MCP, write to files.** The MCP server can create dashboards and alert rules
directly in a live instance, which is the console-drift problem again, only
faster. Point the agent's write end at this folder and let CI apply it.

What the read end is genuinely good for is the part that is hard to do blind:
asking the live stack which metrics and labels actually exist before writing a
query against them.

Then verify rather than trust. `lgtm.overlay.yml` starts the stack, `pnpm start`
produces the failure, and the alert either fires or it does not — a check an
agent can run, and the only thing that distinguishes a working alarm from
plausible YAML.

Scope the token: a Grafana service account limited to this team's folder, or
Grafana Cloud's hosted MCP, which uses OAuth scoped to the signed-in user
instead of a shared secret sitting in a JSON config file.

## Applying it to a real Grafana

The files are the same; only delivery changes.

| Where         | How                                                                |
| ------------- | ------------------------------------------------------------------ |
| Local / OSS   | Mount into `conf/provisioning` — see `lgtm.overlay.yml`            |
| Grafana Cloud | Git Sync (points at this folder), or `grizzly apply`, or Terraform |
| Kubernetes    | Grafana Operator `GrafanaDashboard` / `GrafanaAlertRuleGroup` CRs  |

Two things are environment-specific rather than repo-owned, and both are called
out in the files: the **datasource UID** in `alerting.yml`, and the **contact
point URL**. Substitute them at apply time.

---

## Runbook

### Carrier API auth failures

Fires when more than 5% of quote requests to a single carrier come back as auth
failures over 5 minutes, sustained for 2 minutes.

**What it means.** One carrier's OAuth token stopped refreshing. Grouped per
carrier deliberately: with two carriers sharing traffic, one of them failing
every request only moves the blended error rate to ~50%, and a global threshold
tuned to catch that would be far too twitchy to keep.

**First checks.**

1. Open the _Carrier gateway_ dashboard, _Auth failure ratio_ panel — is it one
   carrier or both? Both means it is us (clock skew, credential rotation,
   egress IP change), one means it is them.
2. _Failed quotes_ panel → pick a line → follow `trace_id` into Tempo for the
   exact request and response status.
3. Check whether the token refresh job ran: `carrier_requests_total` will show
   the failures starting at a sharp edge, not ramping.

**Mitigation.** Force a token refresh. Failing that, route quotes to the other
carrier while the provider is contacted.

**Threshold history.** Started at 5% because a healthy carrier sits under 1%
and retries absorb brief blips. Move it in a PR, with the reason in the commit
message.
