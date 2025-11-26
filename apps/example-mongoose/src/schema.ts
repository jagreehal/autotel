/**
 * Mongoose Schemas
 *
 * Define User and Post models for the example application.
 *
 * Note: Hooks (pre/post) are automatically instrumented by our custom plugin!
 * No manual trace() calls needed - just define your hooks normally and they'll
 * be traced automatically with proper attributes (hook.type, hook.operation, etc.)
 */

import mongoose from 'mongoose';

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// User schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Post schema
const postSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: false,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    published: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Demo middleware/hooks - now AUTOMATICALLY instrumented!
// No manual trace() calls needed - our plugin wraps these automatically
// with proper span creation, attributes (hook.type, hook.operation, etc.)

userSchema.pre(
  'save',
  async function (this: mongoose.Document & { email?: string }) {
    // Hook is automatically traced - no manual instrumentation needed!
    console.log(`🪝 [user pre-save] normalizing ${this.email}`);

    await wait(25);
    if (this.get('name') && typeof this.get('name') === 'string') {
      this.set('name', this.get('name').trim());
    }
  }
);

userSchema.post('save', function (doc) {
  // Automatically traced with attributes: hook.type, hook.operation, hook.model
  console.log(`🪝 [user post-save] persisted ${doc.email}`);
});

userSchema.pre('findOneAndUpdate', function (this: mongoose.Query<any, any>) {
  // Automatically traced
  console.log('🪝 [user pre-findOneAndUpdate] criteria:', this.getQuery());
});

userSchema.post('findOneAndUpdate', function (doc) {
  // Automatically traced
  if (doc) {
    console.log(`🪝 [user post-findOneAndUpdate] updated ${doc.email}`);
  }
});

postSchema.pre('save', async function () {
  // Automatically traced
  console.log('🪝 [post pre-save] preparing post payload');
  await wait(10);
});

postSchema.post('deleteOne', function () {
  // Automatically traced
  console.log('🪝 [post post-deleteOne] post removed');
});

// Export models
export const User = mongoose.model('User', userSchema);
export const Post = mongoose.model('Post', postSchema);
