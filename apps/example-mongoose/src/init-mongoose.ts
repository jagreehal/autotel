/**
 * Mongoose Instrumentation Initialization
 *
 * This file must be imported BEFORE any schema definitions to enable automatic
 * hook instrumentation. The order matters because:
 *
 * 1. instrumentMongoose() patches mongoose.Schema.prototype.pre/post
 * 2. When schemas call .pre()/.post(), our patched version wraps handlers
 * 3. Hooks defined before instrumentation won't be automatically traced
 *
 * ESM import hoisting ensures this runs first when imported at the top of index.ts.
 */

import mongoose from 'mongoose';
import { instrumentMongoose } from 'autotel-plugins/mongoose';

// Instrument Mongoose - this patches Schema.prototype for automatic hook tracing
instrumentMongoose(mongoose, {
  dbName: 'autotel-example',
  peerName: 'localhost',
  peerPort: 27017,
});

console.log('✅ Mongoose instrumented (operations + hooks will be automatically traced)');
