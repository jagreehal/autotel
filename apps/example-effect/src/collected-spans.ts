/**
 * One in-memory exporter, shared by `instrumentation.ts` (which hands it to
 * `init()`) and `index.ts` (which prints what it collected). It is what lets
 * this example *show* the trace shape instead of asserting it.
 *
 * A real service exports to OTLP and reads the shape in its backend; set
 * `OTLP_ENDPOINT` and this one does both.
 */
import { createMemoryExporter } from 'autotel/testing';

export const collected = createMemoryExporter();
