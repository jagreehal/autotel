import {
  init,
  createStructuredError,
  parseError,
  flush,
  shutdown,
  trace,
  ctx,
} from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();

async function main() {
  console.log('=== Chapter 5: Structured Errors ===\n');

  init({
    service: 'book-05',
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Structured errors carry machine-parseable context
  const findUser = trace('user.find', (id: string) => {
    ctx.setAttribute('user.id', id);
    if (id === 'missing') {
      throw createStructuredError({
        message: 'User not found',
        status: 404,
        why: `No user with ID "${id}" exists in the database`,
        fix: 'Verify the user ID or create the account first',
        link: 'https://docs.example.com/errors/user-not-found',
      });
    }
    return { id, name: 'Alice' };
  });

  // Client-side parsing
  try {
    findUser('missing');
  } catch (e) {
    const parsed = parseError(e);
    console.log('  Parsed error:');
    console.log('    message:', parsed.message);
    console.log('    status:', parsed.status);
    console.log('    why:', parsed.why);
    console.log('    fix:', parsed.fix);
    console.log('    link:', parsed.link);
  }

  // Successful case
  const user = findUser('42');
  console.log('\n  Success:', user);

  await flush();
  await shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
