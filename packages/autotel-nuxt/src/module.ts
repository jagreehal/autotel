import { addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

export interface AutotelModuleOptions {
  enabled?: boolean;
}

export default defineNuxtModule<AutotelModuleOptions>({
  meta: {
    name: 'autotel-nuxt',
    configKey: 'autotel',
  },
  defaults: {
    enabled: true,
  },
  setup(options) {
    if (options.enabled === false) return;

    const resolver = createResolver(import.meta.url);
    addServerPlugin(resolver.resolve('./runtime/autotel.plugin'));
  },
});
