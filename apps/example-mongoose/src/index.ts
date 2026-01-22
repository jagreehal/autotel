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
import { mongoUrl } from './config';

// Initialize OpenTelemetry
init({
  service: 'mongoose-example',
  // Print spans to stdout for local debugging (override with AUTOTEL_DEBUG env var)
  debug: 'pretty',
});

// Connect to MongoDB
// Note: we intentionally do NOT read MONGO_URL here to avoid picking up
// a developer's global env var; use MONGOOSE_EXAMPLE_MONGO_URL instead.

// Example: Create a user with autotel tracing
export const createUser = trace('createUser', (ctx) => async (email: string, name?: string) => {
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
export const createPost = trace('createPost', (ctx) => async (
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
export const findUserByEmail = trace('findUserByEmail', (ctx) => async (email: string) => {
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
export const findUserPosts = trace('findUserPosts', (ctx) => async (userId: mongoose.Types.ObjectId) => {
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
export const updateUser = trace('updateUser', (ctx) => async (
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
export const getUserStats = trace('getUserStats', (ctx) => async () => {
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
export const deletePost = trace('deletePost', (ctx) => async (postId: mongoose.Types.ObjectId) => {
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

// Example: Error handling - errors are automatically recorded in spans
export const findUserOrFail = trace('findUserOrFail', (ctx) => async (email: string) => {
  console.log(`\n🔍 Finding user (with error handling): ${email}`);

  ctx.setAttribute('search.email', email);

  const user = await User.findOne({ email });

  if (!user) {
    // This error will be automatically captured in the span
    const error = new Error(`User not found: ${email}`);
    ctx.recordException(error);
    ctx.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR = 2
    console.log(`❌ Error recorded in span: ${error.message}`);
    throw error;
  }

  console.log(`✅ Found user: ${user._id}`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Example: Transaction with session.withTransaction()
export const transferPostOwnership = trace('transferPostOwnership', (ctx) => async (
  postId: mongoose.Types.ObjectId,
  fromUserId: mongoose.Types.ObjectId,
  toUserId: mongoose.Types.ObjectId
) => {
  console.log(`\n🔄 Transferring post ${postId} from ${fromUserId} to ${toUserId}`);

  ctx.setAttribute('post.id', postId.toString());
  ctx.setAttribute('from.userId', fromUserId.toString());
  ctx.setAttribute('to.userId', toUserId.toString());

  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction(async () => {
      // Update post author
      const post = await Post.findByIdAndUpdate(
        postId,
        { author: toUserId },
        { session, new: true }
      );

      if (!post) {
        throw new Error('Post not found');
      }

      // Log the transfer (in a real app, you might have an audit log collection)
      console.log(`  📝 Post "${post.title}" transferred`);

      return post;
    });

    console.log(`✅ Transfer completed in transaction`);
    console.log(`📊 Trace ID: ${ctx.traceId}`);

    return result;
  } finally {
    await session.endSession();
  }
});

// Example: Bulk operations - insertMany
export const createPostsBulk = trace('createPostsBulk', (ctx) => async (
  userId: mongoose.Types.ObjectId,
  posts: Array<{ title: string; content?: string }>
) => {
  console.log(`\n📦 Bulk creating ${posts.length} posts for user ${userId}`);

  ctx.setAttribute('user.id', userId.toString());
  ctx.setAttribute('posts.count', posts.length);

  const postsWithAuthor = posts.map(p => ({
    ...p,
    author: userId,
  }));

  const result = await Post.insertMany(postsWithAuthor);

  console.log(`✅ Created ${result.length} posts via insertMany`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return result;
});

// Example: Bulk operations - bulkWrite
export const bulkUpdatePosts = trace('bulkUpdatePosts', (ctx) => async (
  operations: Array<{ postId: mongoose.Types.ObjectId; published: boolean }>
) => {
  console.log(`\n📦 Bulk updating ${operations.length} posts`);

  ctx.setAttribute('operations.count', operations.length);

  const bulkOps = operations.map(op => ({
    updateOne: {
      filter: { _id: op.postId },
      update: { $set: { published: op.published } },
    },
  }));

  const result = await Post.bulkWrite(bulkOps);

  console.log(`✅ Bulk write: ${result.modifiedCount} modified`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return result;
});

// Example: Instance method - doc.save() instead of Model.create()
export const createUserWithSave = trace('createUserWithSave', (ctx) => async (
  email: string,
  name?: string
) => {
  console.log(`\n📝 Creating user with doc.save(): ${email}`);

  ctx.setAttribute('user.email', email);
  if (name) {
    ctx.setAttribute('user.name', name);
  }

  // Create document instance and save (triggers pre/post save hooks)
  const user = new User({ email, name });
  await user.save();

  console.log(`✅ User created with doc.save(): ${user._id}`);
  console.log(`📊 Trace ID: ${ctx.traceId}`);

  return user;
});

// Single parent span that wraps the entire sample workflow so every helper span
// (and auto-instrumented Mongoose span) becomes a child of one trace.
const runScenario = trace('runScenario', (ctx) => async () => {
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
  const charlieEmail = faker.internet.email({
    firstName: 'Charlie',
    lastName: `Example-${faker.string.uuid()}`,
  });

  // ===== Basic CRUD Operations =====

  // Create users (using Model.create)
  const alice = await createUser(aliceEmail, 'Alice');
  const bob = await createUser(bobEmail, 'Bob');

  // Create user using instance doc.save() method
  const charlie = await createUserWithSave(charlieEmail, 'Charlie');

  // Create posts
  await createPost(alice._id, 'Getting Started with Mongoose', 'Mongoose is a great ODM for MongoDB...');
  await createPost(alice._id, 'OpenTelemetry Tracing', 'Learn how to add tracing to your app...');
  await createPost(bob._id, 'My First Post', 'Hello from Bob!');

  // Find user
  await findUserByEmail(aliceEmail);

  // Find posts with populate
  await findUserPosts(alice._id);

  // Update user
  await updateUser(alice._id, { name: 'Alice Smith' });

  // Get statistics (aggregation)
  await getUserStats();

  // ===== Bulk Operations =====

  // insertMany - create multiple posts at once
  const bulkPosts = await createPostsBulk(charlie._id, [
    { title: 'Bulk Post 1', content: 'Created via insertMany' },
    { title: 'Bulk Post 2', content: 'Also created via insertMany' },
    { title: 'Bulk Post 3', content: 'Third bulk post' },
  ]);

  // bulkWrite - update multiple posts at once
  await bulkUpdatePosts(bulkPosts.map(p => ({ postId: p._id, published: true })));

  // ===== Transactions =====

  // Transfer post ownership within a transaction
  // Note: Transactions require MongoDB replica set (not available in standalone mode)
  const alicePosts = await Post.find({ author: alice._id });
  if (alicePosts.length > 0) {
    try {
      await transferPostOwnership(alicePosts[0]._id, alice._id, bob._id);
    } catch (err: any) {
      if (err?.code === 20 || err?.message?.includes('replica set')) {
        console.log(`  ℹ️  Transaction skipped: requires MongoDB replica set (standalone mode detected)`);
      } else {
        throw err;
      }
    }
  }

  // ===== Error Handling =====

  // Demonstrate error recording in spans
  try {
    await findUserOrFail('nonexistent@example.com');
  } catch {
    // Error is already recorded in the span - we just catch to continue the demo
    console.log(`  ℹ️  Error was captured in span (expected behavior)`);
  }

  // ===== Cleanup =====

  // Delete a post
  const bobPosts = await Post.find({ author: bob._id });
  if (bobPosts.length > 0) {
    await deletePost(bobPosts[0]._id);
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
