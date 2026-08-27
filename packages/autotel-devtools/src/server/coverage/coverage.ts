/**
 * Instrumentation coverage: which entry points never emitted anything.
 *
 * **This is the one question no telemetry backend can answer.** Jaeger,
 * Honeycomb and every viewer like them see spans, so they can only ever
 * describe what you already have. Answering "what am I *not* seeing" needs the
 * source as well as the telemetry, and `autotel map` already reads the source:
 * it walks the project, finds every entry point for the detected framework,
 * and writes `autotel.map.json`.
 *
 * Joining the two turns the viewer from a description of what happened into a
 * checklist of what is still dark, which is the more useful question while you
 * are the one adding the instrumentation.
 *
 * The join is deliberately conservative. A route counts as seen only on
 * evidence that names it — never on a partial match — because a false "yes"
 * here means someone stops looking at a handler that is genuinely silent, and
 * that is worse than the tool admitting it does not know.
 */

/** An entry point as `autotel map` records it. */
export interface MapRoute {
  /** HTTP method, or null for a non-HTTP entry point such as a job. */
  method: string | null;
  /** Route path for HTTP, or the operation name for anything else. */
  path: string;
  /** Repo-relative, POSIX separators. */
  file: string;
  handler?: { line?: number; column?: number } | null;
}

/** What the store has actually seen, counted by the two things spans carry. */
export interface ObservedSpans {
  /** `http.route` attribute value → span count. */
  routeCounts: Record<string, number>;
  /** Span name → span count. */
  spanNameCounts: Record<string, number>;
}

export interface CoverageEntry extends MapRoute {
  seen: boolean;
  spanCount: number;
}

export interface CoverageReport {
  entries: CoverageEntry[];
  seenCount: number;
  total: number;
}

/**
 * The names a span could plausibly carry for this route.
 *
 * `http.route` is the semconv attribute a framework integration sets. The span
 * *name* is the other route in, and for an HTTP handler the convention is
 * `"{method} {route}"`, which is what `trace()` and every framework middleware
 * produce. A non-HTTP entry point has no method, so its own name is the only
 * thing to match.
 */
function candidateNames(route: MapRoute): string[] {
  if (!route.method) return [route.path];
  return [`${route.method.toUpperCase()} ${route.path}`];
}

export function joinCoverage(
  routes: readonly MapRoute[],
  observed: ObservedSpans,
): CoverageReport {
  const entries = routes.map((route): CoverageEntry => {
    // The route attribute is method-agnostic, so it only settles the question
    // for a route with one method. A name match is method-specific and is what
    // keeps `GET /orders` from vouching for `POST /orders`.
    const byRoute = route.method ? 0 : (observed.routeCounts[route.path] ?? 0);
    const byRouteAny = observed.routeCounts[route.path] ?? 0;
    const byName = candidateNames(route).reduce(
      (total, name) => total + (observed.spanNameCounts[name] ?? 0),
      0,
    );

    // A method-carrying route trusts the route attribute only when no name
    // evidence contradicts it: a project whose spans are named by method gets
    // per-method accuracy, and one whose spans are not still gets an answer.
    const namedAnyMethod = Object.keys(observed.spanNameCounts).some((name) =>
      name.endsWith(` ${route.path}`),
    );
    const spanCount =
      byName > 0 ? byName : namedAnyMethod ? 0 : byRoute || byRouteAny;

    return { ...route, seen: spanCount > 0, spanCount };
  });

  // Unseen first: the list exists to show what is missing, and burying that
  // under everything that already works is the wrong way round.
  entries.sort((left, right) => Number(left.seen) - Number(right.seen));

  return {
    entries,
    seenCount: entries.filter((entry) => entry.seen).length,
    total: entries.length,
  };
}
