/**
 * Strict type inference test for the bug:
 * trace() with name parameter returns unknown type
 */

import { trace } from './functional';

// This test file should be checked with: npx tsc --noEmit

// Helper type to detect unknown - this will be 'true' if T is unknown, 'false' otherwise
type IsUnknown<T> = unknown extends T
  ? T extends unknown
    ? true
    : false
  : false;

// Test 1: With explicit TraceContext type - this should always work
const withExplicitType = trace('test-span', () => async () => {
  return { foo: 'bar' };
});

// Type assertion - this line should compile without error if type is inferred correctly
const _test1: () => Promise<{ foo: string }> = withExplicitType;

// Test 2: Without explicit TraceContext type - this is the bug scenario
const withoutExplicitType = trace('test-span', () => async () => {
  return { foo: 'bar' };
});

// Get the inner type of the Promise returned by the function
type InnerReturnType = Awaited<ReturnType<typeof withoutExplicitType>>;

// This will be 'true' if the bug exists (type is unknown)
type IsBugPresent = IsUnknown<InnerReturnType>;

// Type assertion - if the bug exists, this will fail because IsBugPresent is 'true'
// If the bug is fixed, IsBugPresent is 'false' and this compiles
const _bugCheck: IsBugPresent extends false ? 'fixed' : never = 'fixed';

// Type assertion - if the bug exists, this line will fail compilation
// because the return type would be () => Promise<unknown>
const _test2: () => Promise<{ foo: string }> = withoutExplicitType;

// Test 3: Alternative - check if we can access .foo on the result
async function testAccess() {
  const result = await withoutExplicitType();
  // If the type is unknown, TypeScript will error on .foo access
  // If the type is { foo: string }, this compiles fine
  return result.foo;
}

// Prevent unused variable warnings
export { _test1, _test2, testAccess, _bugCheck };
