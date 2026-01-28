import { run } from './cli';

// Run the CLI
run().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
