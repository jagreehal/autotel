import { errorTypeOf, toError } from './structured-error';
import { asRecord, asString } from './values';

export interface ResultFailure {
  type: string;
  message: string | undefined;
  error: Error;
}

/** A string error that names itself (`NOT_FOUND`), as opposed to prose. */
const ERROR_CODE = /^[\w.:/-]{1,64}$/;

/** The failure in a returned `{ ok: false, error }`, if that is what it is. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary: whatever the wrapped function returned
export function resultFailure(returned: unknown): ResultFailure | undefined {
  try {
    const result = asRecord(returned);
    if (result?.ok !== false) return undefined;
    const { error } = result;
    const text = asString(error);
    if (text !== undefined) {
      const type = ERROR_CODE.test(text) ? text : 'Error';
      return { type, message: text, error: toError(error) };
    }
    const fields = asRecord(error);
    return {
      type: asString(fields?.type) || errorTypeOf(error),
      message: asString(fields?.message),
      error: toError(error),
    };
  } catch {
    // A throwing getter counts as no failure, and the call returns as normal.
    return undefined;
  }
}
