import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_COVERAGE_ATTR,
  EVIDENCE_ATTR_PREFIX,
  captureCoverageAttributes,
  evidenceAttribute,
  recordEvidence,
} from './evidence.js';

describe('evidenceAttribute', () => {
  it('namespaces a field name under the evidence prefix', () => {
    expect(evidenceAttribute('cost')).toBe('autotel.evidence.cost');
    expect(EVIDENCE_ATTR_PREFIX).toBe('autotel.evidence.');
  });
});

describe('recordEvidence', () => {
  it('labels why a field is the way it is', () => {
    const setAttribute = vi.fn();
    recordEvidence({ setAttribute }, 'cost', 'estimated');
    expect(setAttribute).toHaveBeenCalledWith(
      'autotel.evidence.cost',
      'estimated',
    );
  });
});

describe('captureCoverageAttributes', () => {
  it('splits surfaces into what this process can and cannot see', () => {
    expect(
      captureCoverageAttributes({
        observed: ['llm_calls', 'tool_calls'],
        unobserved: ['ide_context'],
      }),
    ).toEqual({
      [CAPTURE_COVERAGE_ATTR.observed]: ['llm_calls', 'tool_calls'],
      [CAPTURE_COVERAGE_ATTR.unobserved]: ['ide_context'],
    });
  });

  it('omits an empty list rather than asserting an empty claim', () => {
    // An absent `unobserved` means "not declared", which is the honest default.
    // An empty array would read as "nothing is unobserved" — a claim no
    // deployment can make.
    expect(
      captureCoverageAttributes({ observed: ['llm_calls'], unobserved: [] }),
    ).toEqual({ [CAPTURE_COVERAGE_ATTR.observed]: ['llm_calls'] });
  });

  it('drops a surface claimed as both observed and unobserved', () => {
    // Contradictory claims are worse than no claim: a reader who trusts
    // `observed` would believe a gap does not exist. Neither list keeps it.
    expect(
      captureCoverageAttributes({
        observed: ['llm_calls', 'network'],
        unobserved: ['network', 'ide_context'],
      }),
    ).toEqual({
      [CAPTURE_COVERAGE_ATTR.observed]: ['llm_calls'],
      [CAPTURE_COVERAGE_ATTR.unobserved]: ['ide_context'],
    });
  });
});
