import {
  disableTelemetry,
  enableTelemetry,
  getTelemetryStatus,
  generateDisclosure,
} from 'autotel-telemetry';

export async function runTelemetryStatus(toolName: string): Promise<void> {
  const status = getTelemetryStatus(toolName);
  console.log(JSON.stringify(status, null, 2));
}

export async function runTelemetryEnable(toolName: string): Promise<void> {
  await enableTelemetry(toolName);
  console.log(`Telemetry enabled for ${toolName}`);
}

export async function runTelemetryDisable(toolName: string): Promise<void> {
  await disableTelemetry(toolName);
  console.log(`Telemetry disabled for ${toolName}`);
}

export function runTelemetryDisclosure(toolName: string, version: string): void {
  const disclosure = generateDisclosure({ name: toolName, version });
  console.log(disclosure.markdown);
}
