import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  approvedSnapshot,
  ContractViolationError,
  messageContract,
} from './contract.js';
import { jsonSerializer } from './serializer.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'autotel-contract-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('snapshot contract', () => {
  const order = { orderId: 'ord-1', customer: 'Alice', total: 99.5 };

  it('writes the approved file and passes on first run', () => {
    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given(order)
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).not.toThrow();
  });

  it('passes when the serialized shape is unchanged', () => {
    const run = () =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given(order)
        .whenSerialized()
        .thenContractIsUnchanged();
    run(); // record
    expect(run).not.toThrow(); // compare
  });

  it('fails with a diff when a field is renamed', () => {
    messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
      .given(order)
      .whenSerialized()
      .thenContractIsUnchanged();

    const drifted = { orderId: 'ord-1', customerName: 'Alice', total: 99.5 };
    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given(drifted)
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).toThrowError(ContractViolationError);
  });

  it('is insensitive to object construction order by default', () => {
    messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
      .given({ orderId: 'ord-1', customer: 'Alice', total: 99.5 })
      .whenSerialized()
      .thenContractIsUnchanged();

    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given({ total: 99.5, customer: 'Alice', orderId: 'ord-1' })
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).not.toThrow();
  });

  it('rewrites the approved file in update mode without failing', () => {
    messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
      .given(order)
      .whenSerialized()
      .thenContractIsUnchanged();

    const changed = { orderId: 'ord-1', customer: 'Bob', total: 1 };
    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' }, update: true })
        .given(changed)
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).not.toThrow();

    // Subsequent non-update run now compares against the rewritten file.
    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given(changed)
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).not.toThrow();
  });

  it('pins the bytes the app actually ships when given its serializer', () => {
    const snakeCase = jsonSerializer({ indent: 0 });
    const step = messageContract({
      serializer: {
        name: 'snake',
        serialize: (v) =>
          snakeCase.serialize(v).replaceAll('orderId', 'order_id'),
        deserialize: snakeCase.deserialize,
      },
      snapshot: { dir, name: 'OrderPlaced_snake' },
    })
      .given(order)
      .whenSerialized();
    expect(step.output).toContain('order_id');
    expect(() => step.thenContractIsUnchanged()).not.toThrow();
  });

  it('requires a snapshot name', () => {
    expect(() =>
      messageContract()
        .given(order)
        .whenSerialized()
        .thenContractIsUnchanged(),
    ).toThrowError(/snapshot name is required/);
  });

  it('rejects trying to serialize an approved snapshot source', () => {
    expect(() =>
      messageContract({ snapshot: { dir, name: 'OrderPlaced' } })
        .given(approvedSnapshot())
        .whenSerialized(),
    ).toThrowError(/Cannot serialize an approved snapshot source/);
  });
});

describe('compatibility checks', () => {
  // A reader is a plain parse function here; a Zod/Valibot schema works identically.
  const orderV2Reader = (value: unknown) => {
    const v = value as Record<string, unknown>;
    if (typeof v.orderId !== 'string') throw new Error('orderId must be a string');
    if (typeof v.customer !== 'string') throw new Error('customer must be a string');
    return {
      orderId: v.orderId,
      customer: v.customer,
      coupon: typeof v.coupon === 'string' ? v.coupon : undefined,
    };
  };

  it('passes backward compatibility when a newer reader reads older bytes', async () => {
    const v1 = { orderId: 'ord-1', customer: 'Alice' };
    await expect(
      messageContract()
        .given(v1)
        .whenDeserializedAs(orderV2Reader)
        .thenBackwardCompatible((v2) => {
          expect(v2.coupon).toBeUndefined();
        }),
    ).resolves.toMatchObject({ orderId: 'ord-1' });
  });

  it('fails backward compatibility when a required field was renamed away', async () => {
    const broken = { orderId: 'ord-1', customerName: 'Alice' };
    await expect(
      messageContract()
        .given(broken)
        .whenDeserializedAs(orderV2Reader)
        .thenBackwardCompatible(),
    ).rejects.toThrowError(/Not backward-compatible/);
  });

  it('passes forward compatibility when the newer writer only adds fields', async () => {
    const v2 = { orderId: 'ord-1', customer: 'Alice', coupon: 'SAVE10' };
    const orderV1Reader = (value: unknown) => {
      const v = value as Record<string, unknown>;
      if (typeof v.orderId !== 'string') throw new Error('orderId must be a string');
      if (typeof v.customer !== 'string') throw new Error('customer must be a string');
      return {
        orderId: v.orderId,
        customer: v.customer,
      };
    };

    await expect(
      messageContract()
        .given(v2)
        .whenDeserializedAs(orderV1Reader)
        .thenForwardCompatible(),
    ).resolves.toMatchObject({ orderId: 'ord-1', customer: 'Alice' });
  });

  it('fails compatibility when the reader silently renames a shared field', async () => {
    const driftedReader = (value: unknown) => {
      const v = value as Record<string, unknown>;
      return {
        orderId: v.orderId,
        customerName: v.customer,
      };
    };

    await expect(
      messageContract()
        .given({ orderId: 'ord-1', customer: 'Alice' })
        .whenDeserializedAs(driftedReader)
        .thenBackwardCompatible(),
    ).rejects.toThrowError(/structural incompatibility/);
  });

  it('fails compatibility when the reader changes a shared field value', async () => {
    const lossyReader = (value: unknown) => {
      const v = value as Record<string, unknown>;
      return {
        orderId: v.orderId,
        customer: typeof v.customer === 'string' ? v.customer.toUpperCase() : v.customer,
      };
    };

    await expect(
      messageContract()
        .given({ orderId: 'ord-1', customer: 'Alice' })
        .whenDeserializedAs(lossyReader)
        .thenBackwardCompatible(),
    ).rejects.toThrowError(/\$\.customer: value differs/);
  });

  it('can replay an approved snapshot as the compatibility source', async () => {
    messageContract({ snapshot: { dir, name: 'OrderPlaced_v1' } })
      .given({ orderId: 'ord-1', customer: 'Alice' })
      .whenSerialized()
      .thenContractIsUnchanged();

    await expect(
      messageContract()
        .given(approvedSnapshot({ dir, name: 'OrderPlaced_v1' }))
        .whenDeserializedAs(orderV2Reader)
        .thenBackwardCompatible((v2) => {
          expect(v2.coupon).toBeUndefined();
        }),
    ).resolves.toMatchObject({ orderId: 'ord-1', customer: 'Alice' });
  });

  it('can use the configured snapshot location as the compatibility source', async () => {
    messageContract({ snapshot: { dir, name: 'OrderPlaced_v1' } })
      .given({ orderId: 'ord-1', customer: 'Alice' })
      .whenSerialized()
      .thenContractIsUnchanged();

    await expect(
      messageContract({ snapshot: { dir, name: 'OrderPlaced_v1' } })
        .given(approvedSnapshot())
        .whenDeserializedAs(orderV2Reader)
        .thenBackwardCompatible(),
    ).resolves.toMatchObject({ orderId: 'ord-1', customer: 'Alice' });
  });

  it('fails clearly when the approved snapshot source is missing', async () => {
    await expect(
      messageContract({ snapshot: { dir, name: 'missing' } })
        .given(approvedSnapshot())
        .whenDeserializedAs(orderV2Reader)
        .thenBackwardCompatible(),
    ).rejects.toThrowError(/Cannot read approved snapshot/);
  });

  it('supports a Standard Schema reader', async () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => {
          const v = value as Record<string, unknown>;
          if (typeof v.orderId === 'string') return { value: v };
          return { issues: [{ message: 'orderId required', path: ['orderId'] }] };
        },
      },
    };
    await expect(
      messageContract().given({ orderId: 'ord-1' }).whenDeserializedAs(schema).thenForwardCompatible(),
    ).resolves.toBeDefined();

    await expect(
      messageContract().given({ nope: true }).whenDeserializedAs(schema).thenForwardCompatible(),
    ).rejects.toThrowError(/orderId required/);
  });
});
