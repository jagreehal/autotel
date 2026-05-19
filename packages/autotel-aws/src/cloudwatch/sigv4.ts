/**
 * SigV4 signing helper for CloudWatch OTLP HTTP endpoints.
 *
 * Uses `@smithy/signature-v4` + `@aws-crypto/sha256-js` (optional peer deps).
 * Returns the headers required to POST a signed OTLP request.
 */

import type { CloudWatchSignal } from './endpoints';
import { SIGV4_SERVICE } from './endpoints';

export interface AwsCredentialsLike {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export type AwsCredentialsProvider =
  | AwsCredentialsLike
  | (() => AwsCredentialsLike | Promise<AwsCredentialsLike>);

export interface SignOtlpRequestInput {
  /** The full endpoint URL (e.g. https://xray.eu-west-1.amazonaws.com/v1/traces). */
  url: string;
  /** OTLP payload — already serialized + (optionally) gzipped. */
  body: Uint8Array;
  /** AWS region (e.g. "eu-west-1"). Must match the host. */
  region: string;
  /** Which CloudWatch endpoint we're hitting (selects the SigV4 service name). */
  signal: CloudWatchSignal;
  /** Static credentials or a provider. Falls back to the AWS SDK default chain when omitted. */
  credentials?: AwsCredentialsProvider;
  /** Extra headers to include in the canonical request (signed). */
  additionalHeaders?: Record<string, string>;
  /** Content-Type — defaults to OTLP/JSON. Use `application/x-protobuf` for proto. */
  contentType?: 'application/json' | 'application/x-protobuf';
  /** Content-Encoding (e.g. "gzip"). Omit for identity. */
  contentEncoding?: 'gzip';
}

/**
 * Compute SigV4-signed headers for an OTLP HTTP POST to a CloudWatch endpoint.
 *
 * Throws if the optional `@smithy/signature-v4` / `@aws-crypto/sha256-js`
 * peer dependencies aren't installed — install them alongside autotel-aws
 * when you want to ship telemetry directly from app code (no collector).
 */
export async function signCloudWatchOtlpRequest(
  input: SignOtlpRequestInput,
): Promise<Record<string, string>> {
  const { SignatureV4 } = await loadSigV4();
  const { Sha256 } = await loadSha256();

  const credentials = await resolveCredentials(input.credentials);
  const parsed = new URL(input.url);
  const contentType = input.contentType ?? 'application/json';

  const headers: Record<string, string> = {
    host: parsed.host,
    'content-type': contentType,
    ...(input.contentEncoding && { 'content-encoding': input.contentEncoding }),
    ...input.additionalHeaders,
  };

  const signer = new SignatureV4({
    service: SIGV4_SERVICE[input.signal],
    region: input.region,
    credentials,
    sha256: Sha256,
  });

  const signed = await signer.sign({
    method: 'POST',
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: parsed.pathname + parsed.search,
    headers,
    body: input.body,
  });

  return signed.headers as Record<string, string>;
}

async function resolveCredentials(
  source: AwsCredentialsProvider | undefined,
): Promise<AwsCredentialsLike> {
  if (typeof source === 'function') return source();
  if (source) return source;
  return loadDefaultCredentials();
}

async function loadDefaultCredentials(): Promise<AwsCredentialsLike> {
  try {
    // Optional peer dep — only required when caller doesn't pass credentials.
    const mod = await import('@aws-sdk/credential-providers');
    return await mod.fromNodeProviderChain()();
  } catch (error) {
    throw new Error(
      'autotel-aws/cloudwatch: no credentials supplied and `@aws-sdk/credential-providers` is not installed. ' +
        'Either pass `credentials` explicitly or install the package.',
      { cause: error },
    );
  }
}

async function loadSigV4(): Promise<typeof import('@smithy/signature-v4')> {
  try {
    return await import('@smithy/signature-v4');
  } catch (error) {
    throw new Error(
      'autotel-aws/cloudwatch: `@smithy/signature-v4` is required to sign OTLP requests. ' +
        'Install it (and `@aws-crypto/sha256-js`) alongside autotel-aws.',
      { cause: error },
    );
  }
}

async function loadSha256(): Promise<typeof import('@aws-crypto/sha256-js')> {
  try {
    return await import('@aws-crypto/sha256-js');
  } catch (error) {
    throw new Error(
      'autotel-aws/cloudwatch: `@aws-crypto/sha256-js` is required to sign OTLP requests. ' +
        'Install it alongside `@smithy/signature-v4`.',
      { cause: error },
    );
  }
}
