import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_OUTCOME_LABEL,
  POLICY_DECISION_LABEL,
  SEQUENCE_RULES,
  DETECTION_ATTR,
  DETECTION_EVENT,
  TOOL_CALL_ID_LABEL,
  TOOL_NAME_LABEL,
  detectSequences,
  emitSequenceDetections,
  spansToSequenceEvents,
  type SequenceEvent,
  type SequenceRule,
  type SequenceSpanLike,
} from './sequence.js';
import { AGENT_SECURITY_ATTR } from './agent-security.js';

/** Keys the adapter promotes verbatim — mirrors `LABEL_KEYS` in sequence.ts. */
const LABEL_KEYS_FOR_TEST = [
  AGENT_SECURITY_ATTR.inputProvenance,
  AGENT_SECURITY_ATTR.actionRiskClass,
  AGENT_SECURITY_ATTR.consentOutcome,
  AGENT_SECURITY_ATTR.consentEvidence,
];

const RULE: SequenceRule = {
  id: 'untrusted-then-exfil',
  severity: 'high',
  description: 'external content ingested, then an exfiltration-capable action',
  steps: [
    ['agent.input.provenance=external_untrusted'],
    ['agent.action.risk_class=exfiltration_capable'],
  ],
};

function step(
  timestamp: number,
  labels: string[],
  sessionId = 's1',
): SequenceEvent {
  return { sessionId, timestamp, labels };
}

describe('detectSequences — ordering', () => {
  it('fires when the steps occur in order', () => {
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted']),
        step(2000, ['tool.name=Read']),
        step(3000, ['agent.action.risk_class=exfiltration_capable']),
      ],
      [RULE],
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe('untrusted-then-exfil');
    expect(found[0]?.matchedAt).toEqual([1000, 3000]);
  });

  it('does not fire on the same events in reverse order', () => {
    // The whole claim of a sequence rule is that order carries meaning. An
    // exfil-capable action *before* untrusted content arrived is not the
    // pattern, and a rule that fires on it is a threshold wearing a costume.
    const found = detectSequences(
      [
        step(1000, ['agent.action.risk_class=exfiltration_capable']),
        step(2000, ['agent.input.provenance=external_untrusted']),
      ],
      [RULE],
    );

    expect(found).toEqual([]);
  });

  it('fires once per session, not once per matching pair', () => {
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted']),
        step(2000, ['agent.action.risk_class=exfiltration_capable']),
        step(3000, ['agent.action.risk_class=exfiltration_capable']),
      ],
      [RULE],
    );

    expect(found).toHaveLength(1);
  });

  it('keeps sessions apart', () => {
    // Two unrelated agents, one step each. Correlating across them invents a
    // chain nobody ran.
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted'], 's1'),
        step(2000, ['agent.action.risk_class=exfiltration_capable'], 's2'),
      ],
      [RULE],
    );

    expect(found).toEqual([]);
  });

  it('requires every label on a step, not any of them', () => {
    const twoLabel: SequenceRule = {
      ...RULE,
      steps: [['a=1', 'b=2'], ['c=3']],
    };
    const found = detectSequences(
      [step(1000, ['a=1']), step(2000, ['c=3'])],
      [twoLabel],
    );

    expect(found).toEqual([]);
  });
});

describe('detectSequences — time window', () => {
  const windowed: SequenceRule = { ...RULE, withinMs: 60_000 };

  it('does not fire when the steps are further apart than the window', () => {
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted']),
        step(1000 + 120_000, ['agent.action.risk_class=exfiltration_capable']),
      ],
      [windowed],
    );

    expect(found).toEqual([]);
  });

  it('still finds a later pair that does fit the window', () => {
    // Anchoring greedily on the first matching step and giving up when its
    // window expires misses the real chain that happened afterwards.
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted']),
        step(500_000, ['agent.input.provenance=external_untrusted']),
        step(510_000, ['agent.action.risk_class=exfiltration_capable']),
      ],
      [windowed],
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.matchedAt).toEqual([500_000, 510_000]);
  });
});

describe('detectSequences — correlateBy', () => {
  const denied: SequenceRule = {
    id: 'denied-then-executed',
    severity: 'critical',
    description: 'a human denied a tool, then that same tool ran',
    correlateBy: 'tool.name=',
    steps: [['agent.consent.outcome=denied'], ['agent.outcome=success']],
  };

  it('fires when the denied tool is the one that later ran', () => {
    const found = detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(2000, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      [denied],
    );

    expect(found).toHaveLength(1);
  });

  it('does not fire when a different tool ran after the denial', () => {
    // Denying `Bash` and then successfully running `Read` is a normal session.
    // Without correlation this rule fires on nearly every one of them.
    const found = detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(2000, ['agent.outcome=success', 'tool.name=Read']),
      ],
      [denied],
    );

    expect(found).toEqual([]);
  });
});

describe('SEQUENCE_RULES — the benign corpus', () => {
  // The attack half of a corpus proves nothing: any rule fires on an attack.
  // What decides whether this is a control or a noise generator is what it does
  // on an ordinary working day.
  const benignSession: SequenceEvent[] = [
    step(1000, ['tool.name=Read', 'agent.action.risk_class=read']),
    step(1100, ['agent.input.provenance=user_direct']),
    step(1200, ['tool.name=Grep', 'agent.action.risk_class=read']),
    step(1300, ['tool.name=Edit', 'agent.action.risk_class=write']),
    step(1400, ['agent.consent.outcome=approved', 'tool.name=Bash']),
    step(1500, ['agent.outcome=success', 'tool.name=Bash']),
    step(1600, ['policy.decision=allow', 'tool.name=Write']),
    step(1700, ['tool.name=Edit', 'agent.action.risk_class=write']),
  ];

  it('stays silent on an ordinary session', () => {
    expect(detectSequences(benignSession, SEQUENCE_RULES)).toEqual([]);
  });

  it('stays silent on a long session of repeated safe work', () => {
    // Length alone must not trip anything: a busy day is not an incident.
    const long = Array.from({ length: 200 }, (_, i) =>
      step(1000 + i * 10, ['tool.name=Read', 'agent.action.risk_class=read']),
    );

    expect(detectSequences(long, SEQUENCE_RULES)).toEqual([]);
  });

  it('stays silent when an exfil-capable action precedes untrusted input', () => {
    expect(
      detectSequences(
        [
          step(1000, ['agent.action.risk_class=exfiltration_capable']),
          step(2000, ['agent.input.provenance=external_untrusted']),
        ],
        SEQUENCE_RULES,
      ),
    ).toEqual([]);
  });

  it('stays silent when a denial is followed by a different tool succeeding', () => {
    expect(
      detectSequences(
        [
          step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
          step(2000, ['agent.outcome=success', 'tool.name=Read']),
        ],
        SEQUENCE_RULES,
      ),
    ).toEqual([]);
  });

  it('stays silent when a policy denial is followed by an unrelated destructive action', () => {
    // Denying `Write` and then deleting a scratch file with `Bash` is a normal
    // session. Uncorrelated, this rule fires critical on most of them.
    expect(
      detectSequences(
        [
          step(1000, ['policy.decision=deny', 'tool.name=Write']),
          step(2000, ['agent.action.risk_class=destructive', 'tool.name=Bash']),
        ],
        SEQUENCE_RULES,
      ),
    ).toEqual([]);
  });

  it('fires when the policy-denied tool is the one that ran destructively', () => {
    const found = detectSequences(
      [
        step(1000, ['policy.decision=deny', 'tool.name=Write']),
        step(2000, ['agent.action.risk_class=destructive', 'tool.name=Write']),
      ],
      SEQUENCE_RULES,
    );

    expect(found.map((d) => d.ruleId)).toEqual([
      'policy-denied-then-destructive',
    ]);
  });

  it('fires on the attack half', () => {
    const attack = [
      ...benignSession,
      step(2000, ['agent.input.provenance=external_untrusted']),
      step(2100, ['agent.action.risk_class=exfiltration_capable']),
    ];

    const found = detectSequences(attack, SEQUENCE_RULES);
    expect(found.map((d) => d.ruleId)).toContain(
      'untrusted-input-then-exfiltration',
    );
  });

  it('ranks the most severe finding first', () => {
    const found = detectSequences(
      [
        step(1000, ['agent.input.provenance=external_untrusted']),
        step(1100, ['agent.action.risk_class=exfiltration_capable']),
        step(1200, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(1300, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      SEQUENCE_RULES,
    );

    expect(found.length).toBeGreaterThan(1);
    expect(found[0]?.severity).toBe('critical');
  });
});

describe('sequenceDetectionsToSecurityEvents', () => {
  it('maps severity onto the security-event scale the audit surface uses', async () => {
    const { sequenceDetectionsToSecurityEvents } =
      await import('./sequence.js');
    const found = detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(2000, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      SEQUENCE_RULES,
    );

    const [securityEvent] = sequenceDetectionsToSecurityEvents(found);
    // `SecuritySeverity` has no `high`/`critical` — both land on `critical`
    // and `error` respectively, so a finding never silently downgrades.
    expect(securityEvent?.severity).toBe('critical');
    expect(securityEvent?.name).toBe('agent.sequence.detected');
    expect(securityEvent?.targetId).toBe('denied-then-executed');
    expect(securityEvent?.metadata.sessionId).toBe('s1');
  });
});

describe('SEQUENCE_RULES match real emitted telemetry', () => {
  // The first version of these rules correlated on `gen_ai.tool.name` and
  // matched `tool.outcome=success`. Governance emits `tool.name` and
  // `agent.outcome`, and nothing anywhere emitted `tool.outcome` — so two of
  // three shipped rules could never fire. Rules are only real if they match a
  // span the code actually produces, which is what this asserts.
  function span(
    attributes: Record<string, unknown>,
    seconds: number,
  ): SequenceSpanLike {
    return { attributes, startTime: [seconds, 0] };
  }

  it('fires denied-then-executed on spans recordHumanApproval and withAgentToolCall produce', () => {
    const events = spansToSequenceEvents(
      [
        span(
          {
            [AGENT_SECURITY_ATTR.consentOutcome]: 'denied',
            [AGENT_SECURITY_ATTR.consentEvidence]: 'observed',
            'tool.name': 'Bash',
          },
          1,
        ),
        span({ 'agent.outcome': 'success', 'tool.name': 'Bash' }, 2),
      ],
      () => 'sess-1',
    );

    const found = detectSequences(events, SEQUENCE_RULES);
    expect(found.map((d) => d.ruleId)).toEqual(['denied-then-executed']);
  });

  it('normalises the MCP tool-name spelling onto the governance one', () => {
    // Two layers, two spellings, one meaning. A rule can only carry one label,
    // so the adapter is where they have to agree.
    const events = spansToSequenceEvents(
      [
        span(
          { [AGENT_SECURITY_ATTR.consentOutcome]: 'denied', 'tool.name': 'q' },
          1,
        ),
        span({ 'agent.outcome': 'success', 'gen_ai.tool.name': 'q' }, 2),
      ],
      () => 'sess-1',
    );

    expect(detectSequences(events, SEQUENCE_RULES)).toHaveLength(1);
  });

  it('fires policy-denied-then-destructive on real policy and risk attributes', () => {
    const events = spansToSequenceEvents(
      [
        span({ 'policy.decision': 'deny', 'tool.name': 'Write' }, 1),
        span(
          {
            [AGENT_SECURITY_ATTR.actionRiskClass]: 'destructive',
            'tool.name': 'Write',
          },
          2,
        ),
      ],
      () => 'sess-1',
    );

    expect(
      detectSequences(events, SEQUENCE_RULES).map((d) => d.ruleId),
    ).toEqual(['policy-denied-then-destructive']);
  });

  it('drops spans carrying nothing a rule can match', () => {
    expect(
      spansToSequenceEvents([span({ 'http.method': 'GET' }, 1)], () => 's'),
    ).toEqual([]);
  });

  it('every label a rule references is one the adapter can produce', () => {
    // A rule matching a key the adapter never emits is decoration, and reads as
    // "no findings" rather than as a broken rule.
    const emittable = new Set([
      ...LABEL_KEYS_FOR_TEST,
      TOOL_NAME_LABEL,
      TOOL_CALL_ID_LABEL,
      AGENT_OUTCOME_LABEL,
      POLICY_DECISION_LABEL,
    ]);

    for (const rule of SEQUENCE_RULES) {
      for (const step of rule.steps) {
        for (const label of step) {
          expect(emittable).toContain(label.split('=')[0]);
        }
      }
      const keys =
        rule.correlateBy === undefined
          ? []
          : typeof rule.correlateBy === 'string'
            ? [rule.correlateBy]
            : rule.correlateBy;
      for (const key of keys) {
        expect(emittable).toContain(key.replace(/=$/, ''));
      }
    }
  });
});

describe('emitSequenceDetections', () => {
  function logger() {
    const info = vi.fn();
    return {
      logger: { info, set: vi.fn(), setLevel: vi.fn() } as never,
      records: () => info.mock.calls,
    };
  }

  const twoFindings = () =>
    detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(1100, ['agent.input.provenance=external_untrusted']),
        step(1200, ['agent.action.risk_class=exfiltration_capable']),
        step(2000, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      SEQUENCE_RULES,
    );

  it('writes one correlated log record per finding', () => {
    // securityEvent() only mutates the request snapshot and span attributes,
    // both last-write-wins. Two findings on one request would leave only the
    // last one, and the Sigma rule for the other selects nothing.
    const { logger: l, records } = logger();
    const detections = twoFindings();
    expect(detections.length).toBe(2);

    expect(emitSequenceDetections(detections, { logger: l })).toBe(2);
    expect(records()).toHaveLength(2);
  });

  it('keys each record the way dispositions are keyed, so they can be joined', () => {
    // A finding and the decision about it are separate records, usually in
    // separate traces. They only meet on these two keys.
    const { logger: l, records } = logger();

    emitSequenceDetections(
      detectSequences(
        [
          step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
          step(2000, ['agent.outcome=success', 'tool.name=Bash']),
        ],
        SEQUENCE_RULES,
      ),
      { logger: l },
    );

    expect(records()[0]?.[0]).toBe(DETECTION_EVENT);
    expect(records()[0]?.[1]).toMatchObject({
      [DETECTION_ATTR.ruleId]: 'denied-then-executed',
      [DETECTION_ATTR.correlationId]: 's1',
      [DETECTION_ATTR.severity]: 'critical',
    });
  });

  it('emits nothing when there are no detections', () => {
    const { logger: l, records } = logger();
    expect(emitSequenceDetections([], { logger: l })).toBe(0);
    expect(records()).toHaveLength(0);
  });

  it('does not re-emit a detection it has already reported', () => {
    const { logger: l, records } = logger();
    const seen = new Set<string>();
    const detections = detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(2000, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      SEQUENCE_RULES,
    );

    emitSequenceDetections(detections, { logger: l, seen });
    expect(emitSequenceDetections(detections, { logger: l, seen })).toBe(0);
    expect(records()).toHaveLength(1);
  });

  it('leaves a finding unseen when it could not be emitted', () => {
    // Marking it seen before delivery means the retry that would have reported
    // it is suppressed, and the finding is lost with no trace of the loss.
    const seen = new Set<string>();
    const detections = detectSequences(
      [
        step(1000, ['agent.consent.outcome=denied', 'tool.name=Bash']),
        step(2000, ['agent.outcome=success', 'tool.name=Bash']),
      ],
      SEQUENCE_RULES,
    );

    expect(
      emitSequenceDetections(detections, { logger: null as never, seen }),
    ).toBe(0);
    expect(seen.size).toBe(0);

    const { logger: l, records } = logger();
    expect(emitSequenceDetections(detections, { logger: l, seen })).toBe(1);
    expect(records()).toHaveLength(1);
  });
});
