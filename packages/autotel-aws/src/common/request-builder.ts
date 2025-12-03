/**
 * Request metadata extraction utilities
 */

import type { AWSCommandMetadata } from '../types';

/**
 * Extract request metadata from AWS SDK v3 command
 */
export function extractRequestMetadata(
  command: { constructor: { name: string } },
  context: { clientName: string }
): AWSCommandMetadata {
  return {
    clientName: context.clientName,
    commandName: command.constructor.name,
  };
}

/**
 * Extract service name from AWS SDK client
 */
export function extractServiceName(clientName: string): string {
  // Remove "Client" suffix if present
  return clientName.replace(/Client$/, '');
}

/**
 * Extract operation name from command
 */
export function extractOperationName(commandName: string): string {
  // Remove "Command" suffix if present
  return commandName.replace(/Command$/, '');
}
