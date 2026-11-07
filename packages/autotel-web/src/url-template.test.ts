import { describe, expect, it } from 'vitest';
import { urlTemplate } from './url-template';

describe('urlTemplate', () => {
  it('replaces ObjectIds, UUIDs and numbers with :id', () => {
    expect(
      urlTemplate(
        '/clients/507f1f77bcf86cd799439011/periods/3fa85f64-5717-4562-b3fc-2c963f66afa6/7',
      ),
    ).toBe('/clients/:id/periods/:id/:id');
  });

  it('keeps named segments', () => {
    expect(urlTemplate('/users/me/settings')).toBe('/users/me/settings');
  });

  it('applies an extra global pattern to every segment it matches', () => {
    const pattern = /^ord_\w+$/g;

    expect(urlTemplate('/orders/ord_abc/ord_def', [pattern])).toBe(
      '/orders/:id/:id',
    );
    expect(urlTemplate('/orders/ord_abc', [pattern])).toBe('/orders/:id');
  });
});
