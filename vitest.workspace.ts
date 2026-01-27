import { defineWorkspace } from 'vitest/config';

// Vitest workspace configuration for the monorepo
// This allows the VS Code extension to discover all test configs in one place
export default defineWorkspace([
  // Core package - unit tests
  'packages/autotel/vitest.unit.config.ts',
  // Core package - integration tests
  'packages/autotel/vitest.integration.config.ts',
  
  // Plugins package - unit tests
  'packages/autotel-plugins/vitest.unit.config.ts',
  // Plugins package - integration tests
  'packages/autotel-plugins/vitest.integration.config.ts',
  
  // Cloudflare package - unit tests
  'packages/autotel-cloudflare/vitest.config.ts',
  // Cloudflare package - integration tests
  'packages/autotel-cloudflare/vitest.integration.config.ts',
  
  // Edge package
  'packages/autotel-edge/vitest.config.ts',
  
  // Subscribers package
  'packages/autotel-subscribers/vitest.config.ts',
  
  // MCP package - unit tests
  'packages/autotel-mcp/vitest.config.ts',
  // MCP package - integration tests
  'packages/autotel-mcp/vitest.integration.config.ts',
  
  // Web package
  'packages/autotel-web/vitest.config.ts',

  // CLI package
  'packages/autotel-cli/vitest.unit.config.ts',
]);



