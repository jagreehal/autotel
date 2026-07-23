/**
 * Mongoose Schemas
 *
 * Define User and Post models for the example application.
 *
 * Note: Hooks (pre/post) are automatically instrumented by our custom plugin!
 * No manual trace() calls needed - just define your hooks normally and they'll
 * be traced automatically with proper attributes (hook.type, hook.operation, etc.)
 *
 * The same applies to user-defined statics, instance methods, and query
 * helpers (see below): autotel-mongoose wraps them automatically as the model
 * compiles. You write them as plain Mongoose functions — no trace() calls —
 * and each invocation gets its own span (mongoose.<Model>.<fn>) with the
 * (redacted) parameters captured on `mongoose.method.parameters`.
 */

import mongoose, {
  type Model,
  type QueryWithHelpers,
  type HydratedDocument,
} from 'mongoose';

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// Types for the User model's custom functions
// ---------------------------------------------------------------------------

interface IUser {
  name?: string;
  email: string;
}

// Instance methods (doc.foo())
interface IUserMethods {
  /** Human-readable label for the user. */
  describe(): string;
}

// Query helpers (User.find().byEmailDomain('example.com'))
interface UserQueryHelpers {
  byEmailDomain(
    domain: string
  ): QueryWithHelpers<
    HydratedDocument<IUser, IUserMethods>[],
    HydratedDocument<IUser, IUserMethods>,
    UserQueryHelpers
  >;
}

// Statics (User.findByEmail(...))
interface UserModel
  extends Model<IUser, UserQueryHelpers, IUserMethods> {
  findByEmail(
    email: string
  ): Promise<HydratedDocument<IUser, IUserMethods> | null>;
  countByDomain(domain: string): Promise<number>;
}

// User schema
const userSchema = new mongoose.Schema<
  IUser,
  UserModel,
  IUserMethods,
  UserQueryHelpers
>(
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

// Callback-style hook: `next()` is called from an async continuation. The
// sibling post-save below must appear as a *sibling* span in the trace, not
// as a child of this hook's already-ended span (autotel-mongoose restores the
// parent context when handing control back to the hook chain).
userSchema.post('save', function (doc, next) {
  console.log(`🪝 [user post-save/callback] auditing ${doc.email}`);
  wait(15).then(() => next());
});

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

// ---------------------------------------------------------------------------
// User-defined functions — automatically traced by autotel-mongoose.
// No trace() calls here: the plugin wraps each one as the model compiles.
// ---------------------------------------------------------------------------

// Static: User.findByEmail(email) — span: mongoose.User.findByEmail
userSchema.statics.findByEmail = function findByEmail(email: string) {
  return this.findOne({ email });
};

// Static: User.countByDomain(domain) — span: mongoose.User.countByDomain
userSchema.statics.countByDomain = function countByDomain(domain: string) {
  return this.countDocuments({ email: new RegExp(`@${domain}$`, 'i') }).exec();
};

// Instance method: user.describe() — span: mongoose.User.describe
userSchema.methods.describe = function describe() {
  return this.name ? `${this.name} <${this.email}>` : this.email;
};

// Query helper: User.find().byEmailDomain('example.com')
// span: mongoose.User.byEmailDomain
userSchema.query.byEmailDomain = function byEmailDomain(
  this: QueryWithHelpers<
    HydratedDocument<IUser, IUserMethods>[],
    HydratedDocument<IUser, IUserMethods>,
    UserQueryHelpers
  >,
  domain: string
) {
  return this.where({ email: new RegExp(`@${domain}$`, 'i') });
};

// Export models
export const User = mongoose.model<IUser, UserModel, UserQueryHelpers>(
  'User',
  userSchema
);
export const Post = mongoose.model('Post', postSchema);
