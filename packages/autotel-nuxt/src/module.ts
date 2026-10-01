import { addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';
import type { NuxtModule } from 'nuxt/schema';

export interface AutotelModuleOptions {
  enabled?: boolean;
}

const autotelModule: NuxtModule<AutotelModuleOptions> =
  defineNuxtModule<AutotelModuleOptions>({
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

export default autotelModule;
