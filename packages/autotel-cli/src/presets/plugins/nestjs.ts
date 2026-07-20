import type { PluginPreset } from '../../types/index';

export const nestjs: PluginPreset = {
  name: 'NestJS',
  slug: 'nestjs',
  type: 'plugin',
  description: 'Request-scoped logging via AutotelInterceptor',
  packages: {
    required: ['autotel-adapters'],
    optional: [],
    devOnly: [],
  },
  env: { required: [], optional: [] },
  imports: [
    {
      source: 'autotel-adapters/nestjs',
      specifiers: ['AutotelInterceptor'],
    },
    {
      source: '@nestjs/core',
      specifiers: ['APP_INTERCEPTOR'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// Register globally in AppModule providers:
// { provide: APP_INTERCEPTOR, useClass: AutotelInterceptor }`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Register AutotelInterceptor via APP_INTERCEPTOR in AppModule',
    'Call useLogger() from controllers/services inside requests',
  ],
};
