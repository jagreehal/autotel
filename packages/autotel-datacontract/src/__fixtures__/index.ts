import { readFileSync } from 'node:fs';
import path from 'node:path';

export const customersYaml = readFileSync(
  path.join(import.meta.dirname, 'customers.odcs.yaml'),
  'utf8',
);
