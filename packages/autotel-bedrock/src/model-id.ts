/**
 * Bedrock model identifiers come in three spellings for the same model:
 *
 *   anthropic.claude-sonnet-4-5-20250929-v1:0                       foundation model id
 *   eu.anthropic.claude-sonnet-4-5-20250929-v1:0                    cross-region inference profile
 *   arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0
 *
 * Dashboards, cost tables and model filters want the first. This parses any
 * of them back to it and keeps the other two facts as their own fields.
 */

/** Cross-region inference-profile prefixes Bedrock issues. */
const REGION_PREFIXES = new Set([
  'us',
  'eu',
  'apac',
  'global',
  'jp',
  'au',
  'us-gov',
  'ca',
]);

export interface ParsedBedrockModelId {
  /** Foundation model id with any region prefix or ARN removed. */
  modelId: string;
  /** Region group of a cross-region inference profile (`eu`, `us`, `global`…). */
  inferenceProfileRegion?: string;
  /** The full ARN, when one was used. */
  arn?: string;
  /** Vendor segment of the id: `anthropic`, `amazon`, `meta`, `zai`… */
  vendor?: string;
}

export function parseBedrockModelId(raw: string): ParsedBedrockModelId {
  let id = raw;
  let arn: string | undefined;

  if (id.startsWith('arn:')) {
    arn = id;
    id = id.slice(id.lastIndexOf('/') + 1);
  }

  let inferenceProfileRegion: string | undefined;
  const dot = id.indexOf('.');
  if (dot > 0) {
    const head = id.slice(0, dot);
    // Only strip a prefix that is also followed by a vendor segment, so a
    // bare `us.foo` is not mistaken for a profile of `foo`.
    if (REGION_PREFIXES.has(head) && id.indexOf('.', dot + 1) > dot) {
      inferenceProfileRegion = head;
      id = id.slice(dot + 1);
    }
  }

  const vendorDot = id.indexOf('.');
  const vendor = vendorDot > 0 ? id.slice(0, vendorDot) : undefined;

  return { modelId: id, inferenceProfileRegion, arn, vendor };
}
