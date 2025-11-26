import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createOtelObservability,
  createOtelObservabilityFromEnv,
  OtelObservability,
} from './otel-observability';
import type { AgentObservabilityEvent, MCPObservabilityEvent } from './types';

// Helper to create mock events
function createRpcEvent(method: string, streaming = false): AgentObservabilityEvent {
  return {
    type: 'rpc',
    id: `rpc-${Date.now()}`,
    displayMessage: `RPC call: ${method}`,
    payload: { method, streaming },
    timestamp: Date.now(),
  };
}

function createConnectEvent(connectionId: string): AgentObservabilityEvent {
  return {
    type: 'connect',
    id: `connect-${Date.now()}`,
    displayMessage: `Connection: ${connectionId}`,
    payload: { connectionId },
    timestamp: Date.now(),
  };
}

function createScheduleEvent(
  eventType: 'schedule:create' | 'schedule:execute' | 'schedule:cancel',
  callback: string,
  id: string,
): AgentObservabilityEvent {
  return {
    type: eventType,
    id: `schedule-${Date.now()}`,
    displayMessage: `Schedule ${eventType}: ${callback}`,
    payload: { callback, id },
    timestamp: Date.now(),
  };
}

function createMcpConnectEvent(
  url: string,
  transport: string,
  state: string,
): MCPObservabilityEvent {
  return {
    type: 'mcp:client:connect',
    id: `mcp-${Date.now()}`,
    displayMessage: `MCP connect: ${url}`,
    payload: { url, transport, state },
    timestamp: Date.now(),
  };
}

describe('OtelObservability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createOtelObservability', () => {
    it('should create an OtelObservability instance', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      expect(obs).toBeInstanceOf(OtelObservability);
    });

    it('should accept custom agent options', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
        agents: {
          traceRpc: true,
          traceSchedule: false,
          traceMcp: true,
        },
      });

      expect(obs).toBeInstanceOf(OtelObservability);
    });
  });

  describe('createOtelObservabilityFromEnv', () => {
    it('should create instance from environment variables', () => {
      const env = {
        OTEL_SERVICE_NAME: 'my-agent',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.honeycomb.io',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-honeycomb-team=test-key',
      };

      const obs = createOtelObservabilityFromEnv(env);

      expect(obs).toBeInstanceOf(OtelObservability);
    });

    it('should use defaults when env vars not set', () => {
      const obs = createOtelObservabilityFromEnv({});

      expect(obs).toBeInstanceOf(OtelObservability);
    });

    it('should parse multiple headers', () => {
      const env = {
        OTEL_EXPORTER_OTLP_HEADERS: 'key1=value1,key2=value2,key3=value3',
      };

      const obs = createOtelObservabilityFromEnv(env);

      expect(obs).toBeInstanceOf(OtelObservability);
    });
  });

  describe('emit', () => {
    it('should emit RPC events', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      const event = createRpcEvent('doSomething', false);

      // Should not throw
      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should emit connect events', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      const event = createConnectEvent('conn-123');

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should emit schedule events', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      const event = createScheduleEvent('schedule:create', 'myCallback', 'schedule-123');

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should emit MCP events', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      const event = createMcpConnectEvent('http://mcp-server.local', 'stdio', 'connected');

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should respect traceStateUpdates option', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
        agents: {
          traceStateUpdates: false,
        },
      });

      const event: AgentObservabilityEvent = {
        type: 'state:update',
        id: 'state-123',
        displayMessage: 'State updated',
        payload: {},
        timestamp: Date.now(),
      };

      // Should not throw and should be a no-op due to traceStateUpdates: false
      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should use custom spanNameFormatter', () => {
      const customFormatter = vi.fn((event) => `custom-${event.type}`);

      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
        agents: {
          spanNameFormatter: customFormatter,
        },
      });

      const event = createRpcEvent('testMethod');
      obs.emit(event);

      expect(customFormatter).toHaveBeenCalledWith(event);
    });

    it('should use custom attributeExtractor', () => {
      const customExtractor = vi.fn(() => ({ 'custom.attr': 'value' }));

      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
        agents: {
          attributeExtractor: customExtractor,
        },
      });

      const event = createRpcEvent('testMethod');
      obs.emit(event);

      expect(customExtractor).toHaveBeenCalledWith(event);
    });

    it('should emit with DurableObjectState context', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        exporter: { url: 'http://localhost:4318/v1/traces' },
      });

      const mockCtx = {
        waitUntil: vi.fn(),
      } as unknown as DurableObjectState;

      const event = createRpcEvent('testMethod');

      expect(() => obs.emit(event, mockCtx)).not.toThrow();
    });
  });

  describe('event types', () => {
    const obs = createOtelObservability({
      service: { name: 'test-agent' },
      exporter: { url: 'http://localhost:4318/v1/traces' },
    });

    it('should handle message:request events', () => {
      const event: AgentObservabilityEvent = {
        type: 'message:request',
        id: 'msg-req-123',
        displayMessage: 'Message request',
        payload: {},
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle message:response events', () => {
      const event: AgentObservabilityEvent = {
        type: 'message:response',
        id: 'msg-res-123',
        displayMessage: 'Message response',
        payload: {},
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle message:clear events', () => {
      const event: AgentObservabilityEvent = {
        type: 'message:clear',
        id: 'msg-clr-123',
        displayMessage: 'Messages cleared',
        payload: {},
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle destroy events', () => {
      const event: AgentObservabilityEvent = {
        type: 'destroy',
        id: 'destroy-123',
        displayMessage: 'Agent destroyed',
        payload: {},
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle mcp:client:preconnect events', () => {
      const event: MCPObservabilityEvent = {
        type: 'mcp:client:preconnect',
        id: 'mcp-pre-123',
        displayMessage: 'MCP preconnect',
        payload: { serverId: 'server-1' },
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle mcp:client:authorize events', () => {
      const event: MCPObservabilityEvent = {
        type: 'mcp:client:authorize',
        id: 'mcp-auth-123',
        displayMessage: 'MCP authorize',
        payload: {
          serverId: 'server-1',
          authUrl: 'https://auth.example.com',
          clientId: 'client-123',
        },
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });

    it('should handle mcp:client:discover events', () => {
      const event: MCPObservabilityEvent = {
        type: 'mcp:client:discover',
        id: 'mcp-disc-123',
        displayMessage: 'MCP discover',
        payload: {},
        timestamp: Date.now(),
      };

      expect(() => obs.emit(event)).not.toThrow();
    });
  });
});
