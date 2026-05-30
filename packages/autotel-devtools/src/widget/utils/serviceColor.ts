/**
 * Stable per-service identity colours, shared by the service map (node fills)
 * and the trace list (service pills) so a service is always the same colour
 * everywhere. Soft pastel `fill` + darker `stroke` that read in light and dark.
 */
const NODE_PALETTE = [
  { fill: '#ede9fe', stroke: '#8b5cf6' }, // violet
  { fill: '#ccfbf1', stroke: '#14b8a6' }, // teal
  { fill: '#dbeafe', stroke: '#3b82f6' }, // blue
  { fill: '#fef9c3', stroke: '#ca8a04' }, // amber
  { fill: '#fce7f3', stroke: '#db2777' }, // pink
  { fill: '#dcfce7', stroke: '#16a34a' }, // green
  { fill: '#ffedd5', stroke: '#ea580c' }, // orange
  { fill: '#e0e7ff', stroke: '#6366f1' }, // indigo
] as const;

export function serviceColor(name: string): { fill: string; stroke: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NODE_PALETTE[h % NODE_PALETTE.length];
}
