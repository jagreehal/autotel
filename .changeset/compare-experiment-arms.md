---
'autotel-devtools': minor
---

**Compare offers an experiment's arms.** `GET /api/query/attributes?key=&pair=`
asks which values a field takes and which value of a second field sat on the
same span, so the Compare view lists the experiments in the store and offers the
arms of the one you pick: commonest arm against the next, either side
selectable, and "every other arm" for the rest of the experiment. The pairing
joins `attribute_occurrences`, which is written and deleted with its span, so an
arm is only offered under the experiment it ran with and a pruned experiment
disappears with its traces. Neither side can hold the arm the other is
investigating, and `experiment.name` and `experiment.variant` are left out of
the ranking, since they define the cohorts and separate them perfectly. Values
are escaped into the generated queries, so an arm named `pricing "vip"` still
parses. The picker is hidden when no span carries `experiment.name`.

**Fixed:** a query comparison sent no time window, so it answered over
everything the store held while the toolbar showed something narrower. Both
cohorts now carry the resolved window.

**Also fixed:** `DevtoolsServer` ignored `host` when it opened its own
listener, so an embedder asking for `127.0.0.1` was served on every interface
and their captured telemetry reached the network. It now binds what it was
given; the default, no host, still binds everything.
