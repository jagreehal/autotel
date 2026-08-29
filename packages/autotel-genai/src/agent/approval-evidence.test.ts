import { describe, expect, it, vi } from 'vitest';
import { AGENT_SECURITY_ATTR, recordHumanApproval } from './agent-security.js';

function ctx() {
  const setAttributes = vi.fn();
  return {
    ctx: { setAttribute: vi.fn(), setAttributes } as never,
    attrs: () => setAttributes.mock.calls.at(-1)?.[0] ?? {},
  };
}

describe('recordHumanApproval evidence', () => {
  it('defaults to inferred, because a caller that did not say did not observe', () => {
    // No IDE reports the human's click. An approval reconstructed from "the
    // tool ran after a prompt" must never be cited as a human decision, and
    // silence from the caller is not a claim that it was witnessed.
    const { ctx: c, attrs } = ctx();
    recordHumanApproval({ ctx: c, toolCallId: 't1', approved: true });

    expect(attrs()[AGENT_SECURITY_ATTR.consentOutcome]).toBe('approved');
    expect(attrs()[AGENT_SECURITY_ATTR.consentEvidence]).toBe('inferred');
  });

  it('marks the tool blocked when a human refused it', () => {
    // The consent record names the tool, so a span carrying `tool.name` no
    // longer means the tool ran. A denial has to say so in the tool's own
    // vocabulary, or "did it run" cannot be answered from the trace.
    const { ctx: c, attrs } = ctx();
    recordHumanApproval({
      ctx: c,
      toolCallId: 't1',
      toolName: 'issue_refund',
      approved: false,
      evidence: 'observed',
    });

    expect(attrs()['tool.status']).toBe('blocked');
  });

  it('leaves the tool status alone when the human approved', () => {
    // The tool call itself owns `planned` → `complete`; an approval must not
    // pre-empt it.
    const { ctx: c, attrs } = ctx();
    recordHumanApproval({
      ctx: c,
      toolCallId: 't1',
      toolName: 'issue_refund',
      approved: true,
      evidence: 'observed',
    });

    expect(attrs()).not.toHaveProperty('tool.status');
  });

  it('records an observed decision when the caller saw one', () => {
    const { ctx: c, attrs } = ctx();
    recordHumanApproval({
      ctx: c,
      toolCallId: 't1',
      approved: false,
      evidence: 'observed',
    });

    expect(attrs()[AGENT_SECURITY_ATTR.consentOutcome]).toBe('denied');
    expect(attrs()[AGENT_SECURITY_ATTR.consentEvidence]).toBe('observed');
  });
});
