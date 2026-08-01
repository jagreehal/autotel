# Observability Engineering, as running code

Chapter 8 tells you to start wide and split on the symptom. You nod. Then you
open your own service and find no function called split-on-the-symptom.

This directory is an attempt to close that gap for one language.

Each example takes a concept from _Observability Engineering_, second edition,
by Charity Majors, Liz Fong-Jones, George Miranda, and Austin Parker, and runs
it as a TypeScript program against [Autotel](../../README.md), an OpenTelemetry
instrumentation library. Every file sets up a small scene, instruments it,
asserts the thing the chapter said would be true, and prints what it found. A
passing example prints. A broken concept exits non-zero, which is the point:
these run in CI, so a regression in the library shows up as a chapter that
stops working.

The usual routes out of that gap all leak somewhere. Port the book's Go snippet
and you spend the afternoon on idioms rather than the practice. Follow a vendor
tutorial and the lesson expires with the contract, because you learned their
query builder. Try it on your own service and you cannot separate a bad
hypothesis from a bad deploy. These files stay short enough to read in one
sitting and break the build when they stop being true. You give up realism to
get that.

## Run them

```sh
pnpm install
pnpm --filter @autotel/book-chapters test:oe    # the 11 chapter examples
pnpm --filter @autotel/book-chapters example:oe-08   # one of them
```

Node 22+. No backend, no API key, no Docker. Every example collects its own
spans in memory.

Chapters 21 and 22 are the exception: they call a real model, because a chapter
about measuring LLM behaviour that hardcodes its own token counts is not
measuring anything. They use [Ollama](https://ollama.com) on localhost, so
nothing leaves your machine and nothing bills you.

```sh
ollama serve
ollama pull llama3.2       # override with OLLAMA_MODEL
```

Without a model to reach, both print what they would have needed and exit 0.
They skip rather than fall back to invented numbers, so CI stays green and no
run ever prints a figure that came from this repo rather than a span.

## The chapters

| Ch  | _Observability Engineering_ 2e     | Example                      | What it demonstrates                                                    |
| --- | ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| 1   | What Is Observability?             | `oe-01-questions.ts`         | An unplanned failure gets grouped by a field you never planned to use   |
| 2   | How Code Crosses Over              | `oe-02-production-intent.ts` | A schema mismatch records its path and drops its value                  |
| 5   | Structured Events                  | `oe-05-structured-events.ts` | A nested call joins the parent trace without being handed the context   |
| 8   | Getting Started with Analysis      | `oe-08-analysis-loop.ts`     | `compareCohorts()` ranks `payment.provider` above every other field     |
| 11  | Using SLOs for Reliability         | `oe-11-slo.ts`               | 5 failures per 1,000 burn a 99.9% monthly budget in six days            |
| 12  | Acting On SLO-Based Alerts         | `oe-12-burn-alert.ts`        | Two windows agree, and the forecast exhausts the budget within 24 hours |
| 15  | Cheap and Accurate Enough Sampling | `oe-15-sampling.ts`          | The chapter's nine-rung ladder, from keep-everything to head-and-tail   |
| 18  | Observability for CI/CD Pipelines  | `oe-18-cicd.ts`              | A pipeline run reads as a root span with one child per job              |
| 20  | Performance Engineering            | `oe-20-performance.ts`       | Latency halves, and the row count on the same span says why             |
| 21  | Observability for LLMs             | `oe-21-llm-evaluation.ts`    | A live model call carries its measured tokens and its grade together    |
| 22  | Fin's Case Study                   | `oe-22-case-study.ts`        | A streamed reply is judged on resolution, measured latency, and length  |

Chapters 3, 4, 6, 7, 9, and 16 are covered by the numbered examples in this
directory, which tour the Autotel API rather than follow the book's argument.
Run those with `pnpm --filter @autotel/book-chapters test`.

## Chapters with no example here, and why

Chapters 13 and 14 describe how Retriever and ClickHouse store events. Autotel
exports OTLP and stops at the wire, so an example would be theatre. The authors
ship runnable ClickHouse DDL and queries. Use theirs.

Chapter 10 (AI agents) and chapters 23 through 32 (governance, business case,
team structure) argue about decisions people make. Nothing runs.

Chapter 19 covers mobile and frontend, where the `autotel-web` browser package
applies. That example belongs in a browser harness, not this Node process.

## The authors' own code

The official companion code is linked from the book's own "Using Code Examples"
section: <https://oreil.ly/7IcWz>.
It is the canonical source, in the book's own languages, and it covers ground
these examples do not: the `isBurnViolation` predictive alert that the chapter
12 forecast here is modelled on, runnable ClickHouse DDL and queries, and a
dependency-free Node tracer that builds a span out of a log line one field at a
time.

Their `2e/chapter-15-sampling/` walks nine sampling strategies in Go, one
directory per rung. `oe-15-sampling.ts` walks the same nine in the same order,
so the two read side by side. Theirs is the book's code; this one shows which
of the nine a library can hand you already.

Read `2e/chapter-05-structured-events/tracer.js` there before
`oe-05-structured-events.ts` here. That file shows you where `parentSpanID`
comes from. This one shows you what a library does with it once you stop
writing your own.

## Chapter 8, one more time

`oe-08-analysis-loop.ts` builds eighty checkout spans, splits them on latency,
ranks every recorded field by how much it separates the two groups, and names
`bank-beta`. It takes about a second. The loop in the chapter was always
correct. It needed a keyboard.
