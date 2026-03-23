/**
 * Deterministic service-name → terminal color mapping.
 * Hash the name, pick from a palette. Same service always gets same color.
 */

export const SERVICE_COLORS = [
  'cyan',
  'magenta',
  'blue',
  'yellow',
  'green',
  'redBright',
  'cyanBright',
  'magentaBright',
  'blueBright',
  'yellowBright',
  'greenBright',
] as const;

export type ServiceColor = (typeof SERVICE_COLORS)[number];

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = Math.trunc((hash << 5) - hash + s.codePointAt(i)!);
  }
  return Math.abs(hash);
}

export function getServiceColor(serviceName: string): ServiceColor {
  return SERVICE_COLORS[hashString(serviceName) % SERVICE_COLORS.length];
}
