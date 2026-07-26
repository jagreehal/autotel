import { parseError, withTracing } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import {
  defineValidator,
  onValidationMismatch,
  type ValidationMismatch,
} from 'autotel/validate';

const checkoutInput = defineValidator(
  'POST /checkout',
  {
    safeParse(input: unknown) {
      const candidate = input as { items?: unknown };
      if (Array.isArray(candidate?.items) && candidate.items.length > 0) {
        return { success: true as const, data: candidate };
      }
      return {
        success: false as const,
        error: {
          issues: [
            {
              path: ['items'],
              code: 'too_small',
              expected: 'non-empty array',
            },
          ],
        },
      };
    },
  },
  { boundary: 'http' },
);

const collector = createTraceCollector();
let mismatch: ValidationMismatch | undefined;
const unsubscribe = onValidationMismatch((event) => {
  mismatch = event;
});
const handle = withTracing({ name: 'checkout.validate' })(
  () => (input: unknown) => checkoutInput.parse(input),
);

try {
  handle({ items: [] });
  throw new Error('Expected validation to reject the payload');
} catch (error) {
  const parsed = parseError(error);
  if (parsed.status !== 400) throw error;
}
unsubscribe();

collector.expectSpan('checkout.validate');
if (mismatch?.issues[0]?.path !== 'items') {
  throw new Error('Expected the PII-safe validation path');
}

console.log('OE 2: production input diverged from the declared contract');
console.log('  recorded path: items, recorded value: none');
