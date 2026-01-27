import type { PluginPreset } from '../../types/index.js';

/**
 * Mongoose plugin preset
 */
export const mongoose: PluginPreset = {
  name: 'Mongoose',
  slug: 'mongoose',
  type: 'plugin',
  description: 'Instrument Mongoose ODM for MongoDB tracing',
  packages: {
    required: [
      'autotel-plugins',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-plugins/mongoose',
      specifiers: ['instrumentMongoose'],
    },
    {
      source: 'mongoose',
      default: 'mongoose',
    },
  ],
  configBlock: {
    type: 'plugin',
    code: 'instrumentMongoose(mongoose);',
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Mongoose operations will now be traced',
    'Spans will include query, collection, and timing information',
  ],
};

/**
 * Drizzle plugin preset
 */
export const drizzle: PluginPreset = {
  name: 'Drizzle',
  slug: 'drizzle',
  type: 'plugin',
  description: 'Instrument Drizzle ORM for database tracing',
  packages: {
    required: [
      'autotel-plugins',
    ],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-plugins/drizzle',
      specifiers: ['instrumentDrizzle'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: '// Call instrumentDrizzle(db) with your Drizzle instance',
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Import instrumentDrizzle and call it with your Drizzle instance',
    'Example: const db = instrumentDrizzle(drizzle(pool))',
  ],
};
