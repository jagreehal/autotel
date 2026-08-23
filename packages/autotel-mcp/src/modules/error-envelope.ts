/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This is the error surface. `toErrorMessage` reads what a `catch` binds, which the language types as `unknown`, and `details` carries whatever context the thrower attached on its way to a JSON envelope. Naming a type for either would be naming a type for "anything a dependency can throw". */

export interface ToolOkEnvelope<T> {
  ok: true;
  data: T;
  timestamp: string;
}

export interface ToolErrorEnvelope {
  ok: false;
  error: {
    message: string;
    code?: string;
    status?: number;
    details?: Record<string, unknown>;
  };
  timestamp: string;
}

export function okEnvelope<T>(data: T): ToolOkEnvelope<T> {
  return {
    ok: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function errorEnvelope(params: {
  message: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}): ToolErrorEnvelope {
  return {
    ok: false,
    error: {
      message: params.message,
      code: params.code,
      status: params.status,
      details: params.details,
    },
    timestamp: new Date().toISOString(),
  };
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
