/**
 * AWS error classification and handling
 */

/**
 * AWS error types
 */
export interface AWSError {
  name: string;
  message: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
  Code?: string;
  StatusCode?: number;
}

/**
 * Classify AWS error for span status
 */
export function classifyAWSError(error: unknown): {
  isError: boolean;
  statusCode?: number;
  errorCode?: string;
} {
  if (!error || typeof error !== 'object') {
    return { isError: false };
  }

  const awsError = error as AWSError;

  // Check for HTTP status code
  const statusCode = awsError.$metadata?.httpStatusCode || awsError.StatusCode;

  // Determine if it's an error (4xx or 5xx)
  const isError = statusCode !== undefined && statusCode >= 400;

  return {
    isError,
    statusCode,
    errorCode: awsError.Code || awsError.name,
  };
}

/**
 * Extract error attributes from AWS error
 */
export function extractErrorAttributes(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== 'object') {
    return {};
  }

  const awsError = error as AWSError;
  const attrs: Record<string, string | number> = {};

  if (awsError.name) {
    attrs['error.type'] = awsError.name;
  }

  if (awsError.message) {
    attrs['error.message'] = awsError.message;
  }

  if (awsError.Code) {
    attrs['aws.error.code'] = awsError.Code;
  }

  if (awsError.$metadata?.requestId) {
    attrs['aws.request_id'] = awsError.$metadata.requestId;
  }

  if (awsError.$metadata?.httpStatusCode) {
    attrs['http.status_code'] = awsError.$metadata.httpStatusCode;
  }

  return attrs;
}
