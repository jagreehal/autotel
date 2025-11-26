/**
 * Mongoose + Autotel Example
 *
 * This example demonstrates how to use autotel with Mongoose 8+ using the
 * custom autotel-plugins/mongoose implementation (runtime patching).
 *
 * Key features:
 * - Automatic OpenTelemetry tracing for Mongoose operations (via runtime patching)
 * - Automatic hook instrumentation (pre/post hooks traced without manual code)
 * - Functional API with trace() wrapper for custom spans
 * - Works with Mongoose 8.x and 9.x in ESM+tsx environments
 *
 * Setup:
 * 1. pnpm install
 * 2. pnpm docker:up  (starts MongoDB)
 * 3. pnpm start
 *
 * Why not use the official @opentelemetry/instrumentation-mongoose?
 * - The official package is broken in ESM+tsx environments
 * - Module loading hooks fail with ESM import hoisting
 * - Our runtime patching approach works everywhere
 */

import 'dotenv/config';
import { faker } from '@faker-js/faker';
import { init, trace, shutdown } from 'autotel';

// IMPORTANT: Instrument mongoose BEFORE importing schemas to enable automatic hook tracing
import './init-mongoose';

// NOW import schemas/models - hooks are automatically instrumented
import mongoose from 'mongoose';
import { User, Post } from './schema';

// Initialize OpenTelemetry
init({
  service: 'mongoose-example',
  debug: true,
});

// Connect to MongoDB
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/autotel-example';

// Example: Create a user with autotel tracing
export const createUser = trace((ctx) => async (email: string, name?: string) => {
  console.log(`\n📝 Creating user: ${email}`);

  // Set custom attributes for better observability
  ctx.setAttribute('user.email', email);
  if (name) {
    ctx.setAttribute('user.name', name);
  }

  const user = await User.create({ email, name });

  console.log(`✅ User created with ID: ${user._id}`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Example: Create a post for a user
export const createPost = trace((ctx) => async (
  userId: mongoose.Types.ObjectId,
  title: string,
  content?: string
) => {
  console.log(`\n📝 Creating post for user ${userId}: ${title}`);

  ctx.setAttribute('post.userId', userId.toString());
  ctx.setAttribute('post.title', title);

  const post = await Post.create({
    title,
    content,
    author: userId,
  });

  console.log(`✅ Post created with ID: ${post._id}`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return post;
});

// Example: Find user by email
export const findUserByEmail = trace((ctx) => async (email: string) => {
  console.log(`\n🔍 Finding user by email: ${email}`);

  ctx.setAttribute('search.email', email);

  const user = await User.findOne({ email });

  if (user) {
    console.log(`✅ Found user: ${user._id}`);
  } else {
    console.log(`❌ User not found`);
  }

  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Example: Find posts by user with population
export const findUserPosts = trace((ctx) => async (userId: mongoose.Types.ObjectId) => {
  console.log(`\n🔍 Finding posts for user: ${userId}`);

  ctx.setAttribute('user.id', userId.toString());

  const posts = await Post
    .find({ author: userId })
    .populate('author')
    .sort({ createdAt: -1 });

  console.log(`✅ Found ${posts.length} posts`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return posts;
});

// Example: Update user
export const updateUser = trace((ctx) => async (
  userId: mongoose.Types.ObjectId,
  updates: { name?: string; email?: string }
) => {
  console.log(`\n✏️  Updating user: ${userId}`);

  ctx.setAttribute('user.id', userId.toString());
  ctx.setAttribute('updates', JSON.stringify(updates));

  const user = await User.findByIdAndUpdate(
    userId,
    updates,
    { new: true, runValidators: true }
  );

  if (user) {
    console.log(`✅ User updated`);
  } else {
    console.log(`❌ User not found`);
  }

  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Example: Aggregation pipeline
export const getUserStats = trace((ctx) => async () => {
  console.log(`\n📊 Getting user statistics`);

  const stats = await User.aggregate([
    {
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'author',
        as: 'posts',
      },
    },
    {
      $project: {
        email: 1,
        name: 1,
        postCount: { $size: '$posts' },
      },
    },
    {
      $sort: { postCount: -1 },
    },
  ]);

  console.log(`✅ Retrieved stats for ${stats.length} users`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return stats;
});

// Example: Delete operation
export const deletePost = trace((ctx) => async (postId: mongoose.Types.ObjectId) => {
  console.log(`\n🗑️  Deleting post: ${postId}`);

  ctx.setAttribute('post.id', postId.toString());

  const result = await Post.deleteOne({ _id: postId });

  if (result.deletedCount > 0) {
    console.log(`✅ Post deleted`);
  } else {
    console.log(`❌ Post not found`);
  }

  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return result;
});

// Single parent span that wraps the entire sample workflow so every helper span
// (and auto-instrumented Mongoose span) becomes a child of one trace.
const runScenario = trace((ctx) => async () => {
  ctx.setAttribute('scenario.name', 'mongoose-demo');
  ctx.setAttribute('scenario.runId', faker.string.uuid());

  // Use unique emails on each run so the sample is idempotent
  const aliceEmail = faker.internet.email({
    firstName: 'Alice',
    lastName: `Example-${faker.string.uuid()}`,
  });
  const bobEmail = faker.internet.email({
    firstName: 'Bob',
    lastName: `Example-${faker.string.uuid()}`,
  });

  // Create users
  const alice = await createUser(aliceEmail, 'Alice');
  const bob = await createUser(bobEmail, 'Bob');

  // Create posts
  await createPost(alice._id, 'Getting Started with Mongoose', 'Mongoose is a great ODM for MongoDB...');
  await createPost(alice._id, 'OpenTelemetry Tracing', 'Learn how to add tracing to your app...');
  await createPost(bob._id, 'My First Post', 'Hello from Bob!');

  // Find user
  await findUserByEmail(aliceEmail);

  // Find posts
  await findUserPosts(alice._id);

  // Update user
  await updateUser(alice._id, { name: 'Alice Smith' });

  // Get statistics
  await getUserStats();

  // Delete a post
  const posts = await Post.find({ author: bob._id });
  if (posts.length > 0) {
    await deletePost(posts[0]._id);
  }
});

// Run the example
async function main() {
  console.log('\n🚀 Starting Mongoose + Autotel Example\n');
  console.log('All operations are automatically traced with OpenTelemetry!');

  await mongoose.connect(mongoUrl);
  console.log(`✅ Connected to MongoDB: ${mongoUrl}\n`);

  try {
    await runScenario();
    console.log('\n✅ Example completed successfully!');
    console.log('📊 Check your observability backend for traces');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // Flush all spans before exiting
    await shutdown();
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

main();
