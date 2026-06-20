import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSecuritySignalProcessor,
  SUSPICIOUS_REQUEST_PATTERNS,
  type SecuritySignal,
} from './security-signals';

const counterAdd = vi.fn();

vi.mock('autotel', () => ({
  createCounter: vi.fn(() => ({ add: counterAdd })),
  AUTOTEL_SAMPLING_TAIL_EVALUATED: 'autotel.sampling.tail.evaluated',
  AUTOTEL_SAMPLING_TAIL_KEEP: 'autotel.sampling.tail.keep',
  REDACTOR_PATTERNS: {
    sensitiveKey: /(token|secret|password|api[-_]?key)$/i,
  },
}));

function makeSpan(attributes: Record<string, unknown>) {
  const span = {
    attributes: attributes as never,
    spanContext: attributes.spanContext as { traceId: string } | undefined,
    setAttribute: vi.fn((key: string, value: unknown) => {
      (span.attributes as Record<string, unknown>)[key] = value;
    }),
  };
  return span;
}

describe('createSecuritySignalProcessor — suspicious requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['path traversal', '/files/../../etc/passwd', 'path_traversal'],
    ['encoded traversal', '/files/%2e%2e%2fadmin', 'path_traversal'],
    ['.env probe', '/.env', 'sensitive_file_probe'],
    ['.git probe', '/.git/config', 'sensitive_file_probe'],
    ['sqli probe', "/search?q=' or '1'='1", 'sqli_probe'],
    ['union select', '/items?id=1 union select password', 'sqli_probe'],
    ['xss probe', '/comment?text=<script>alert(1)</script>', 'xss_probe'],
    ['null byte', '/download?file=report%00.pdf', 'null_byte'],
  ])('flags %s', (_label, target, expectedPattern) => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      onSignal: (s) => signals.push(s),
    });

    const span = makeSpan({ 'url.path': target });
    processor.onStart(span);

    expect(span.setAttribute).toHaveBeenCalledWith(
      'security.suspicious_request',
      true,
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'security.signal',
      expectedPattern,
    );
    expect(signals).toEqual([
      { signal: 'suspicious_request', pattern: expectedPattern, target },
    ]);
  });

  it('force-keeps flagged spans through tail sampling by default', () => {
    const processor = createSecuritySignalProcessor();
    const span = makeSpan({ 'url.path': '/.env' });

    processor.onStart(span);

    expect(span.setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.evaluated',
      true,
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.keep',
      true,
    );
  });

  it('leaves normal requests untouched', () => {
    const processor = createSecuritySignalProcessor();
    const span = makeSpan({ 'url.path': '/api/users/123/orders' });

    processor.onStart(span);

    expect(span.setAttribute).not.toHaveBeenCalled();
    expect(counterAdd).not.toHaveBeenCalled();
  });

  it('reads legacy http.target attribute', () => {
    const processor = createSecuritySignalProcessor();
    const span = makeSpan({ 'http.target': '/wp-admin/setup.php' });

    processor.onStart(span);

    expect(span.setAttribute).toHaveBeenCalledWith(
      'security.signal',
      'sensitive_file_probe',
    );
  });

  it('supports extra patterns', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      extraPatterns: { graphql_introspection: /__schema/i },
      onSignal: (s) => signals.push(s),
    });

    processor.onStart(makeSpan({ 'url.path': '/graphql?query={__schema}' }));

    expect(signals[0]).toMatchObject({ pattern: 'graphql_introspection' });
  });

  it('emits the suspicious metric', () => {
    const processor = createSecuritySignalProcessor();
    processor.onStart(makeSpan({ 'url.path': '/.env' }));

    expect(counterAdd).toHaveBeenCalledWith(1, {
      pattern: 'sensitive_file_probe',
    });
  });

  it('never throws when the onSignal callback throws', () => {
    const processor = createSecuritySignalProcessor({
      onSignal: () => {
        throw new Error('subscriber bug');
      },
    });

    expect(() =>
      processor.onStart(makeSpan({ 'url.path': '/.env' })),
    ).not.toThrow();
  });
});

describe('createSecuritySignalProcessor — denied responses and bursts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts denied statuses', () => {
    const processor = createSecuritySignalProcessor();

    processor.onEnd(makeSpan({ 'http.response.status_code': 401 }));
    processor.onEnd(makeSpan({ 'http.status_code': 403 }));
    processor.onEnd(makeSpan({ 'http.response.status_code': 200 }));

    expect(counterAdd).toHaveBeenCalledWith(1, { status: 401 });
    expect(counterAdd).toHaveBeenCalledWith(1, { status: 403 });
    expect(counterAdd).toHaveBeenCalledTimes(2);
  });

  it('signals an auth-failure burst exactly once per window crossing', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: { threshold: 3, windowMs: 60_000 },
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    const failedLogin = () => {
      clock += 1000;
      processor.onEnd(
        makeSpan({
          'http.response.status_code': 401,
          'client.address': '203.0.113.7',
        }),
      );
    };

    failedLogin();
    failedLogin();
    expect(signals).toHaveLength(0);

    failedLogin(); // 3rd in window → crossing
    expect(signals).toEqual([
      {
        signal: 'auth_failure_burst',
        key: '203.0.113.7',
        count: 3,
        windowMs: 60_000,
        status: 401,
      },
    ]);

    failedLogin(); // 4th — already past threshold, no duplicate signal
    expect(signals).toHaveLength(1);
  });

  it('expires hits outside the window', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: { threshold: 3, windowMs: 10_000 },
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    const failAt = (t: number) => {
      clock = t;
      processor.onEnd(
        makeSpan({
          'http.response.status_code': 401,
          'client.address': '203.0.113.7',
        }),
      );
    };

    failAt(1_000_000);
    failAt(1_005_000);
    failAt(1_020_000); // first two expired — count back to 1, then 2, no signal
    failAt(1_021_000);
    expect(signals).toHaveLength(0);

    failAt(1_022_000); // 3 inside the 10s window → signal
    expect(signals).toHaveLength(1);
  });

  it('tracks bursts per client independently', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: { threshold: 2, windowMs: 60_000 },
      onSignal: (s) => signals.push(s),
      now: () => 1_000_000,
    });

    const failFrom = (ip: string) =>
      processor.onEnd(
        makeSpan({
          'http.response.status_code': 401,
          'client.address': ip,
        }),
      );

    failFrom('203.0.113.1');
    failFrom('203.0.113.2');
    expect(signals).toHaveLength(0);

    failFrom('203.0.113.1');
    expect(signals).toEqual([
      expect.objectContaining({ key: '203.0.113.1', count: 2 }),
    ]);
  });

  it('429s count as denied but not toward auth bursts by default', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: { threshold: 1 },
      onSignal: (s) => signals.push(s),
      now: () => 1_000_000,
    });

    processor.onEnd(
      makeSpan({
        'http.response.status_code': 429,
        'client.address': '203.0.113.9',
      }),
    );

    expect(counterAdd).toHaveBeenCalledWith(1, { status: 429 });
    expect(signals).toHaveLength(0);
  });

  it('can disable burst detection', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: false,
      onSignal: (s) => signals.push(s),
    });

    for (let i = 0; i < 50; i++) {
      processor.onEnd(
        makeSpan({
          'http.response.status_code': 401,
          'client.address': '203.0.113.7',
        }),
      );
    }

    expect(signals).toHaveLength(0);
  });

  it('bounds tracked clients to maxKeys', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      burst: { threshold: 2, maxKeys: 2 },
      onSignal: (s) => signals.push(s),
      now: () => 1_000_000,
    });

    const failFrom = (ip: string) =>
      processor.onEnd(
        makeSpan({
          'http.response.status_code': 401,
          'client.address': ip,
        }),
      );

    failFrom('a'); // tracked: a
    failFrom('b'); // tracked: a, b
    failFrom('c'); // evicts a; tracked: b, c
    failFrom('a'); // re-tracked fresh — count 1, not 2
    expect(signals).toHaveLength(0);

    failFrom('a'); // now 2 → signal
    expect(signals).toEqual([expect.objectContaining({ key: 'a', count: 2 })]);
  });
});

describe('createSecuritySignalProcessor — LLM consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags a single call above the token ceiling', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      llm: { maxTokensPerCall: 10_000 },
      onSignal: (s) => signals.push(s),
    });

    processor.onEnd(
      makeSpan({
        'gen_ai.usage.total_tokens': 50_000,
        'gen_ai.response.model': 'claude-opus-4-8',
      }),
    );

    expect(signals).toEqual([
      {
        signal: 'llm_excessive_tokens',
        tokens: 50_000,
        maxTokens: 10_000,
        model: 'claude-opus-4-8',
      },
    ]);
    expect(counterAdd).toHaveBeenCalledWith(1, {
      signal: 'llm_excessive_tokens',
    });
  });

  it('sums input+output when total_tokens is absent', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      llm: { maxTokensPerCall: 1000 },
      onSignal: (s) => signals.push(s),
    });

    processor.onEnd(
      makeSpan({
        'gen_ai.usage.input_tokens': 800,
        'gen_ai.usage.output_tokens': 700,
      }),
    );

    expect(signals[0]).toMatchObject({
      signal: 'llm_excessive_tokens',
      tokens: 1500,
    });
  });

  it('stays quiet for calls under the ceiling', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      onSignal: (s) => signals.push(s),
    });

    processor.onEnd(makeSpan({ 'gen_ai.usage.total_tokens': 5000 }));

    expect(signals).toHaveLength(0);
  });

  it('signals a per-user token budget crossing exactly once', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      llm: {
        maxTokensPerCall: false,
        tokenBudget: { budget: 10_000, windowMs: 60_000 },
      },
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    const llmCall = (tokens: number) => {
      clock += 1000;
      processor.onEnd(
        makeSpan({
          'gen_ai.usage.total_tokens': tokens,
          'enduser.id': 'user-7',
        }),
      );
    };

    llmCall(4000);
    llmCall(4000);
    expect(signals).toHaveLength(0);

    llmCall(4000); // 12k in window → crossing
    expect(signals).toEqual([
      {
        signal: 'llm_token_budget_exceeded',
        key: 'user-7',
        tokens: 12_000,
        budget: 10_000,
        windowMs: 60_000,
      },
    ]);

    llmCall(4000); // still over — no duplicate signal
    expect(signals).toHaveLength(1);
  });

  it('budget tracking is per user', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      llm: {
        maxTokensPerCall: false,
        tokenBudget: { budget: 5000 },
      },
      onSignal: (s) => signals.push(s),
      now: () => 1_000_000,
    });

    const llmCallBy = (userId: string, tokens: number) =>
      processor.onEnd(
        makeSpan({
          'gen_ai.usage.total_tokens': tokens,
          'enduser.id': userId,
        }),
      );

    llmCallBy('user-1', 3000);
    llmCallBy('user-2', 3000);
    expect(signals).toHaveLength(0);

    llmCallBy('user-1', 3000);
    expect(signals).toEqual([
      expect.objectContaining({
        signal: 'llm_token_budget_exceeded',
        key: 'user-1',
        tokens: 6000,
      }),
    ]);
  });

  it('can disable LLM signals entirely', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      llm: false,
      onSignal: (s) => signals.push(s),
    });

    processor.onEnd(makeSpan({ 'gen_ai.usage.total_tokens': 999_999 }));

    expect(signals).toHaveLength(0);
    expect(counterAdd).not.toHaveBeenCalled();
  });

  it('ignores non-LLM spans', () => {
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      onSignal: (s) => signals.push(s),
    });

    processor.onEnd(makeSpan({ 'http.response.status_code': 200 }));

    expect(signals).toHaveLength(0);
  });
});

describe('SUSPICIOUS_REQUEST_PATTERNS', () => {
  it('does not flag common legitimate paths', () => {
    const legitimate = [
      '/api/users/123',
      '/search?q=union+station+select+board',
      '/files/report-2026.pdf',
      '/blog/scripting-languages-compared',
      '/env/production/status',
      '/git-tutorial/intro',
    ];

    for (const path of legitimate) {
      for (const [name, pattern] of Object.entries(
        SUSPICIOUS_REQUEST_PATTERNS,
      )) {
        expect(pattern.test(path), `${name} flagged ${path}`).toBe(false);
      }
    }
  });
});

describe('createSecuritySignalProcessor — suspicious action chains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits llm_action_chain_suspicious and stamps security attrs on the destructive span', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    processor.onStart(
      makeSpan({
        'mcp.tool.untrusted_content': true,
        'mcp.tool.name': 'read_inbox',
        spanContext: { traceId: 'trace-abc' },
      }),
    );

    clock += 5000;
    const destructive = makeSpan({
        'mcp.tool.destructive': true,
        'mcp.tool.name': 'send_email',
        spanContext: { traceId: 'trace-abc' },
      });
    processor.onStart(destructive);

    expect(signals).toEqual([
      expect.objectContaining({
        signal: 'llm_action_chain_suspicious',
        traceId: 'trace-abc',
        untrustedTool: 'read_inbox',
        toolName: 'send_email',
      }),
    ]);
    expect(destructive.setAttribute).toHaveBeenCalledWith(
      'security.event',
      'llm.action_chain.suspicious',
    );
    expect(destructive.setAttribute).toHaveBeenCalledWith(
      'security.category',
      'llm',
    );
    expect(destructive.setAttribute).toHaveBeenCalledWith(
      'security.untrustedTool',
      'read_inbox',
    );
    expect(destructive.setAttribute).toHaveBeenCalledWith(
      'security.destructiveTool',
      'send_email',
    );
    expect(destructive.setAttribute).toHaveBeenCalledWith(
      'autotel.sampling.tail.keep',
      true,
    );
  });

  it('does not re-emit for later destructive spans unless another untrusted span appears', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    processor.onStart(
      makeSpan({
        'mcp.tool.untrusted_content': true,
        'mcp.tool.name': 'read_inbox',
        spanContext: { traceId: 'trace-repeat' },
      }),
    );

    clock += 1000;
    processor.onStart(
      makeSpan({
        'mcp.tool.destructive': true,
        'mcp.tool.name': 'send_email',
        spanContext: { traceId: 'trace-repeat' },
      }),
    );

    clock += 1000;
    processor.onStart(
      makeSpan({
        'mcp.tool.destructive': true,
        'mcp.tool.name': 'delete_message',
        spanContext: { traceId: 'trace-repeat' },
      }),
    );

    expect(
      signals.filter((signal) => signal.signal === 'llm_action_chain_suspicious'),
    ).toHaveLength(1);
  });

  it('expires stale untrusted traces before evaluating destructive spans', () => {
    let clock = 1_000_000;
    const signals: SecuritySignal[] = [];
    const processor = createSecuritySignalProcessor({
      actionChainWindowMs: 10_000,
      onSignal: (s) => signals.push(s),
      now: () => clock,
    });

    processor.onStart(
      makeSpan({
        'mcp.tool.untrusted_content': true,
        'mcp.tool.name': 'read_inbox',
        spanContext: { traceId: 'trace-expire' },
      }),
    );

    clock += 20_000;
    processor.onStart(
      makeSpan({
        'mcp.tool.destructive': true,
        'mcp.tool.name': 'send_email',
        spanContext: { traceId: 'trace-expire' },
      }),
    );

    expect(signals).toHaveLength(0);
  });
});
