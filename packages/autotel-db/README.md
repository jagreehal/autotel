# autotel-db

The vocabulary autotel's database instrumentations share when they say more
than "a query ran": which statement it was, and what the database did to
answer it.

No dependencies and no Node built-ins, so the readers (devtools in a browser,
the MCP server) use the same code as the producers.

| Producer           | Database | Plan source                 |
| ------------------ | -------- | --------------------------- |
| `autotel-drizzle`  | Postgres | `EXPLAIN (FORMAT JSON)`     |
| `autotel-mongodb`  | MongoDB  | `explain('executionStats')` |
| `autotel-mongoose` | MongoDB  | via `autotel-mongodb`       |

## API

```typescript
import { hashStatement, planAttributes, type QueryPlan } from 'autotel-db';

span.setAttribute('db.statement.hash', hashStatement(valueFreeStatement));

const plan: QueryPlan = {
  nodes: ['Seq Scan'],
  fullScan: true,
  indexes: [],
  rowsExamined: 200_199,
  rowsReturned: 1001,
};
span.setAttributes(planAttributes(plan));
```

- `hashStatement(text)`: 14 hex characters, synchronous, the same in Node and a
  browser. It groups queries; it is not a security hash.
- `planAttributes(plan)`: a `QueryPlan` as span attributes. Fields the plan left
  out are left out.
- `QueryPlan`, `PlanAttributes`, `ExplainMode` (`'plan' | 'analyze'`).
- `ATTR_DB_*` constants for every name below.

## Attributes

| Attribute                                                | Meaning                                                |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `db.statement.hash`                                      | The statement with its values stripped, hashed         |
| `db.plan.node`                                           | Root operation: `Seq Scan`, `SORT`, `IXSCAN`           |
| `db.plan.full_scan`                                      | Any operation read a whole table or collection         |
| `db.plan.indexes`                                        | Comma-separated indexes the plan used                  |
| `db.plan.hash`                                           | Hash of the operations in order; changes with the plan |
| `db.plan.rows_examined`                                  | Rows or documents read                                 |
| `db.plan.rows_returned`                                  | Rows or documents returned                             |
| `db.plan.rows_estimated`                                 | Rows the planner expected                              |
| `db.plan.cost`                                           | Planner cost, in the database's own units              |
| `db.plan.blocks`                                         | Storage blocks touched, cached or not                  |
| `db.plan.execution_ms`                                   | Server-side execution time                             |
| `db.plan.index_suggestion`                               | A statement creating the index this query lacked       |
| `db.plan.stages`                                         | Every operation, root first: `[SORT, FETCH, IXSCAN]`   |
| `db.plan.keys_examined`                                  | Index keys read (MongoDB)                              |
| `db.plan.blocking_sort`                                  | The plan sorted in memory                              |
| `db.plan.mode`                                           | `plan` (planner only) or `analyze` (executed)          |
| `db.plan.status`                                         | `captured`, `failed`, or `unsupported`; absent = off   |
| `db.plan.error`                                          | Why it `failed`: the database's first error line       |
| `db.plan.index_suggestion.equality` / `.sort` / `.range` | The suggested keys by the job they do                  |

Same `db.statement.hash`, different `db.plan.hash`: the planner changed its
mind. `db.plan.full_scan: true` finds a Postgres `Seq Scan` and a MongoDB
`COLLSCAN` with one query.

## Capture status

A span with no `db.plan.status` was never explained, which almost always means
explain is off. `planUnavailableAttributes('failed' | 'unsupported', { mode,
error })` records the other outcomes, so a reader can tell "turn explain on"
from "explain ran and could not" from "this operation has nothing to plan".

`readPlan(attributes)` reads all of it back, and `groupQueries(spans)` keeps
each statement's latest captured plan with the run it came from
(`planSample`), apart from the latency it reports across every run, plus
`planIssue` when no run captured one. Statements are grouped per database
system and namespace, so the same statement in two databases stays two.

## Adding a database

Write the adapter in its own package: read the database's explain output into a
`QueryPlan`, and hash a statement whose values are already stripped. The names,
the hash and the attribute mapping stay here, which is what lets a reader treat
every database alike.
