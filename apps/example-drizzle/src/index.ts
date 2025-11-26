/**
 * Drizzle ORM + Autotel Example
 *
 * This example demonstrates how to use autotel with Drizzle ORM.
 *
 * Key features:
 * - Automatic OpenTelemetry tracing for Drizzle operations
 * - Minimal setup (just 3 lines!)
 * - Functional API with trace() wrapper
 * - Works with SQLite, PostgreSQL, MySQL, and more
 *
 * Setup:
 * 1. pnpm install
 * 2. pnpm db:push
 * 3. pnpm start
 */

import 'dotenv/config';
import { init, trace, type TraceContext } from 'autotel';
import { instrumentDrizzleClient } from 'autotel-plugins/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from './schema';

// Initialize autotel
init({
  service: 'drizzle-example',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create LibSQL client for SQLite
const client = createClient({
  url: 'file:./drizzle/dev.db',
});

// Create Drizzle instance and instrument it (this is all you need!)
const db = instrumentDrizzleClient(
  drizzle({ client, schema }),
  { dbSystem: 'sqlite' }
);

const { users, posts } = schema;

// Example: Create a user with autotel tracing
export const createUser = trace(ctx => async (email: string, name?: string) => {
  console.log(`Creating user: ${email}`);

  // Set custom attributes for better observability
  ctx.setAttribute('user.email', email);
  if (name) {
    ctx.setAttribute('user.name', name);
  }

  const [user] = await db
    .insert(users)
    .values({ email, name })
    .returning();

  console.log(`✅ User created with ID: ${user.id}`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Example: Create a post for a user
export const createPost = trace(ctx => async (
  userId: number,
  title: string,
  content?: string
) => {
  console.log(`Creating post for user ${userId}: ${title}`);

  ctx.setAttribute('post.userId', userId);
  ctx.setAttribute('post.title', title);

  const [post] = await db
    .insert(posts)
    .values({
      title,
      content,
      authorId: userId,
    })
    .returning();

  console.log(`✅ Post created with ID: ${post.id}`);

  return post;
});

// Example: Get user with posts (demonstrates nested queries)
export const getUserWithPosts = trace(ctx => async (userId: number) => {
  console.log(`Fetching user ${userId} with posts`);

  ctx.setAttribute('user.id', userId);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      posts: true,
    },
  });

  if (user) {
    ctx.setAttribute('user.postCount', user.posts.length);
    console.log(`✅ Found user with ${user.posts.length} posts`);
  } else {
    console.log(`❌ User not found`);
  }

  return user;
});

// Example: Update post status
export const publishPost = trace(ctx => async (postId: number) => {
  console.log(`Publishing post ${postId}`);

  ctx.setAttribute('post.id', postId);

  const [post] = await db
    .update(posts)
    .set({ published: true })
    .where(eq(posts.id, postId))
    .returning();

  console.log(`✅ Post published`);

  return post;
});

// Example: Complex operation with multiple database calls
export const createUserWithPosts = trace((ctx: TraceContext) => async (
  email: string,
  name: string,
  postTitles: string[]
) => {
  console.log(`Creating user ${email} with ${postTitles.length} posts`);

  ctx.setAttribute('user.email', email);
  ctx.setAttribute('user.postCount', postTitles.length);

  // Create user (traced automatically as child span)
  const user = await createUser(email, name);

  // Create posts (each traced automatically as child span)
  const createdPosts = await Promise.all(
    postTitles.map(title => createPost(user.id, title))
  );

  console.log(`✅ Created user with ${createdPosts.length} posts`);

  return { user, posts: createdPosts };
});

// Example: Transaction with multiple operations
export const createUserAndPostInTransaction = trace(ctx => async (
  email: string,
  name: string,
  postTitle: string
) => {
  console.log(`Creating user and post in transaction: ${email}`);

  ctx.setAttribute('user.email', email);
  ctx.setAttribute('post.title', postTitle);

  const result = await db.transaction(async (tx) => {
    // Create user in transaction
    const [user] = await tx
      .insert(users)
      .values({ email, name })
      .returning();

    // Create post for that user in same transaction
    const [post] = await tx
      .insert(posts)
      .values({
        title: postTitle,
        authorId: user.id,
      })
      .returning();

    return { user, post };
  });

  console.log(`✅ Transaction completed - User ${result.user.id}, Post ${result.post.id}`);

  return result;
});

// Main function
async function main() {
  console.log('🚀 Starting Drizzle + Autotel example...\n');

  try {
    // Example 1: Create a single user
    console.log('📝 Example 1: Creating a user');
    const user = await createUser('alice@example.com', 'Alice');
    console.log('');

    // Example 2: Create a post
    console.log('📄 Example 2: Creating a post');
    const post = await createPost(user.id, 'My First Post', 'Hello, World!');
    console.log('');

    // Example 3: Publish the post
    console.log('🚀 Example 3: Publishing the post');
    await publishPost(post.id);
    console.log('');

    // Example 4: Get user with posts
    console.log('👤 Example 4: Fetching user with posts');
    const userWithPosts = await getUserWithPosts(user.id);
    console.log('User:', userWithPosts);
    console.log('');

    // Example 5: Complex operation - create user with multiple posts
    console.log('🎯 Example 5: Creating user with multiple posts (nested traces)');
    const result = await createUserWithPosts(
      'bob@example.com',
      'Bob',
      ['First Post', 'Second Post', 'Third Post']
    );
    console.log('Result:', {
      userId: result.user.id,
      postCount: result.posts.length,
    });
    console.log('');

    // Example 6: Transaction
    console.log('💾 Example 6: Creating user and post in a transaction');
    const txResult = await createUserAndPostInTransaction(
      'charlie@example.com',
      'Charlie',
      'Transaction Test Post'
    );
    console.log('Transaction result:', {
      userId: txResult.user.id,
      postId: txResult.post.id,
    });
    console.log('');

    // Wait for traces to be exported
    console.log('⏳ Waiting 2 seconds for traces to be exported...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('✅ Examples completed!');
    console.log('📊 Check your observability backend to see the traces.');
    console.log('\n💡 Tip: Each Drizzle operation is automatically traced with SQL query details.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }

  process.exit(0);
}

// Run if executed directly
main().catch(console.error);
