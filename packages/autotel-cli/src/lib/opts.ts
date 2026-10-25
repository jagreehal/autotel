/**
 * Reading flags off Commander's parsed options.
 *
 * `optsWithGlobals()` is typed as a bag of `any`, because its shape depends on
 * the options each command declared. These readers name what a flag was
 * declared to produce and check it, so a mismatch between the declaration and
 * the read surfaces here rather than as a wrong value deep in a query.
 */
import type { OptionValues } from 'commander';
import { asNumber, asString } from './values';

/** A flag declared without an argument parser: Commander yields its string. */
export function stringOpt(o: OptionValues, key: string): string | undefined {
  const value = asString(o[key]);
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** A flag declared with `intArg` or another numeric parser. */
export function numberOpt(o: OptionValues, key: string): number | undefined {
  const value = asNumber(o[key]);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/** A boolean flag: present or absent. */
export function boolOpt(o: OptionValues, key: string): boolean | undefined {
  const value = o[key];
  return value === true || value === false ? value : undefined;
}

/** A flag whose value must be one of a fixed set. */
export function enumOpt<T extends string>(
  o: OptionValues,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = stringOpt(o, key);
  return allowed.find((candidate) => candidate === value);
}
