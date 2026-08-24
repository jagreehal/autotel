import { describe, expect, it, vi } from 'vitest';
import {
  DETECTION_ATTR,
  SEQUENCE_RULES,
  detectSequences,
  emitSequenceDetections,
  sequenceDetectionsToSecurityEvents,
} from './sequence.js';
import { sequenceRuleToSigma, sequenceRulesToSigma } from './sigma.js';

describe('sequenceRuleToSigma', () => {
  const rule = SEQUENCE_RULES.find((r) => r.id === 'denied-then-executed');

  it('selects the emitted detection, not the sequence final step', () => {
    // Selecting the final step alerts on every successful tool call — it is the
    // rule's least specific ingredient, not the rule. The detection event has
    // the ordering, session boundary and correlation already applied.
    const yaml = sequenceRuleToSigma(rule!);

    expect(yaml).toContain('security.event: agent.sequence.detected');
    expect(yaml).toContain('security.target_id: denied-then-executed');
    expect(yaml).toContain('condition: selection');
  });

  it('never selects on a bare step attribute', () => {
    const yaml = sequenceRuleToSigma(rule!);
    const selection = yaml.slice(
      yaml.indexOf('  selection:'),
      yaml.indexOf('  condition:'),
    );

    expect(selection).not.toContain('agent.outcome');
    expect(selection).not.toContain('tool.name');
  });

  it('records the steps that were matched, for the analyst reading the alert', () => {
    const yaml = sequenceRuleToSigma(rule!);

    expect(yaml).toContain('agent.consent.outcome: denied');
    expect(yaml).toContain('agent.outcome: success');
    expect(yaml).toMatch(/tool\.name=/);
  });

  it('maps severity onto the Sigma level vocabulary', () => {
    expect(sequenceRuleToSigma(rule!)).toContain('level: critical');
  });

  it('carries a stable id so a SIEM can track the rule across regenerations', () => {
    const first = sequenceRuleToSigma(rule!);
    const second = sequenceRuleToSigma(rule!);

    expect(first).toBe(second);
    expect(first).toMatch(/^id: autotel-denied-then-executed$/m);
  });

  it('quotes a selection value that YAML would otherwise read as structure', () => {
    const yaml = sequenceRuleToSigma({
      id: 'odd: id # here',
      severity: 'low',
      description: 'plain',
      steps: [['k=v']],
    });

    expect(yaml).toContain("security.target_id: 'odd: id # here'");
  });

  it('keeps a multi-line description inside the block scalar', () => {
    const yaml = sequenceRuleToSigma({
      id: 'x',
      severity: 'low',
      description: 'first line\nsecond line',
      steps: [['k=v']],
    });

    expect(yaml).toContain('  first line\n  second line');
  });
});

describe('sequenceRulesToSigma', () => {
  it('generates one document per shipped rule', () => {
    const docs = sequenceRulesToSigma(SEQUENCE_RULES);

    expect(docs).toHaveLength(SEQUENCE_RULES.length);
    expect(docs.map((d) => d.ruleId)).toContain('denied-then-executed');
    expect(docs[0]?.yaml).toContain('logsource:');
  });
});

describe('generated selections name attributes that are actually emitted', () => {
  it('selects only fields sequenceDetectionsToSecurityEvents produces', () => {
    // The same failure mode as a sequence rule matching an invented key: a
    // Sigma rule naming an attribute nothing emits reads as "no findings"
    // rather than as a broken rule.
    const detection = {
      ruleId: 'denied-then-executed',
      severity: 'critical' as const,
      description: 'x',
      sessionId: 's1',
      matchedAt: [1, 2],
      firstAt: 1,
      lastAt: 2,
    };
    const [event] = sequenceDetectionsToSecurityEvents([detection]);

    expect(event?.name).toBe('agent.sequence.detected');
    expect(event?.targetId).toBe('denied-then-executed');

    const yaml = sequenceRuleToSigma(
      SEQUENCE_RULES.find((r) => r.id === 'denied-then-executed')!,
    );
    expect(yaml).toContain(`security.event: ${event?.name}`);
    expect(yaml).toContain(`security.target_id: ${event?.targetId}`);
  });
});

describe('generated field list', () => {
  it('lists only fields a detection record actually carries', () => {
    // The first version listed `security.session_id`, which nothing emits — an
    // analyst opening the alert gets an empty column and no way to know why.
    const yaml = sequenceRuleToSigma(
      SEQUENCE_RULES.find((r) => r.id === 'denied-then-executed')!,
    );
    const fields = yaml
      .slice(yaml.indexOf('fields:'), yaml.indexOf('falsepositives:'))
      .split('\n')
      .filter((line) => line.startsWith('  - '))
      .map((line) => line.slice(4));

    const emitted = new Set([
      ...Object.values(DETECTION_ATTR),
      'security.event',
      'security.target_id',
      'security.severity',
    ]);

    for (const field of fields) expect(emitted).toContain(field);
    expect(fields).toContain(DETECTION_ATTR.correlationId);
    expect(fields).toContain(DETECTION_ATTR.ruleId);
  });
});

describe('the generated selection matches a real emitted record', () => {
  // The two halves were verified separately and agreed with nothing: the record
  // carried `detection.*`, the selection required `security.event` and
  // `security.target_id`, and those only ever reached the span. Parse the
  // selection out of the generated YAML and assert the record satisfies it.
  function selectionOf(yaml: string): Record<string, string> {
    const block = yaml.slice(
      yaml.indexOf('  selection:') + '  selection:\n'.length,
      yaml.indexOf('  condition:'),
    );
    const out: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const match = /^ {4}([^:]+): (.*)$/.exec(line);
      if (match?.[1] && match[2] !== undefined) {
        out[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
      }
    }
    return out;
  }

  it('every selection field is present, with that value, on the record', () => {
    const info = vi.fn();
    const detections = detectSequences(
      [
        {
          sessionId: 's1',
          timestamp: 1000,
          labels: ['agent.consent.outcome=denied', 'tool.name=Bash'],
        },
        {
          sessionId: 's1',
          timestamp: 2000,
          labels: ['agent.outcome=success', 'tool.name=Bash'],
        },
      ],
      SEQUENCE_RULES,
    );

    emitSequenceDetections(detections, {
      logger: { info, set: vi.fn(), setLevel: vi.fn() } as never,
    });

    const record = info.mock.calls[0]?.[1] as Record<string, unknown>;
    const rule = SEQUENCE_RULES.find((r) => r.id === 'denied-then-executed');
    const selection = selectionOf(sequenceRuleToSigma(rule!));

    expect(Object.keys(selection).length).toBeGreaterThan(0);
    for (const [field, value] of Object.entries(selection)) {
      expect(record[field]).toBe(value);
    }
  });
});
