/**
 * Prisma + Autotel Example
 *
 * This example demonstrates how to use autotel with Prisma ORM.
 *
 * Key features:
 * - Automatic OpenTelemetry tracing for Prisma operations
 * - Minimal setup compared to vanilla OpenTelemetry
 * - Functional API with trace() wrapper
 *
 * Setup:
 * 1. pnpm install
 * 2. pnpm db:generate
 * 3. pnpm db:push
 * 4. pnpm start
 */

import 'dotenv/config';
import { init, trace, type TraceContext } from 'autotel';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { PrismaClient } from '@prisma/client';

// Initialize autotel with PrismaInstrumentation
init({
  service: 'prisma-example',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  instrumentations: [
    new PrismaInstrumentation(),
  ],
});

// Create Prisma client
const prisma = new PrismaClient();

// Example: Create a user with autotel tracing
export const createUser = trace(ctx => async (email: string, name?: string) => {
  console.log(`Creating user: ${email}`);

  // Set custom attributes for better observability
  ctx.setAttribute('user.email', email);
  if (name) {
    ctx.setAttribute('user.name', name);
  }

  const user = await prisma.user.create({
    data: { email, name },
  });

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

  const post = await prisma.post.create({
    data: {
      title,
      content,
      authorId: userId,
    },
  });

  console.log(`✅ Post created with ID: ${post.id}`);

  return post;
});

// Example: Get user with posts (demonstrates nested queries)
export const getUserWithPosts = trace(ctx => async (userId: number) => {
  console.log(`Fetching user ${userId} with posts`);

  ctx.setAttribute('user.id', userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
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

  const post = await prisma.post.update({
    where: { id: postId },
    data: { published: true },
  });

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
  const posts = await Promise.all(
    postTitles.map(title => createPost(user.id, title))
  );

  console.log(`✅ Created user with ${posts.length} posts`);

  return { user, posts };
});

// Main function
async function main() {
  console.log('🚀 Starting Prisma + Autotel example...\n');

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

    // Wait for traces to be exported
    console.log('⏳ Waiting 2 seconds for traces to be exported...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('✅ Examples completed!');
    console.log('📊 Check your observability backend to see the traces.');
    console.log('\n💡 Tip: Each Prisma operation is automatically traced with detailed span information.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }

  process.exit(0);
}

// Run if executed directly
main().catch(console.error);
