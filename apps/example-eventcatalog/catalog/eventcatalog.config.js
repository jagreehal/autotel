/** @type {import('@eventcatalog/core/bin/eventcatalog.config').Config} */
export default {
  cId: 'autotel-example-catalog',
  title: 'Autotel Commerce',
  tagline: 'Architecture that documents itself — populated from autotel telemetry.',
  organizationName: 'Autotel',
  homepageLink: 'https://github.com/jagreehal/autotel',
  editUrl: 'https://github.com/jagreehal/autotel/edit/main/apps/example-eventcatalog/catalog',
  port: 3000,
  outDir: 'dist',
  logo: {
    src: '/logo.svg',
    text: 'Autotel Commerce',
  },
  base: '/',
  trailingSlash: false,

  // Theme that pairs well with the autotel brand: warm, confident, not generic.
  theme: 'sunset',

  mermaid: {
    enableSupportForElkLayout: true,
    iconPacks: ['logos'],
  },

  rss: {
    enabled: true,
    limit: 15,
  },

  search: {
    type: 'indexed',
  },

  // The narrative the visitor walks through. Order matters: lead with the
  // checkout flow (the headline artifact), then the services that produce it,
  // then the events on the wire.
  navigation: {
    pages: [
      {
        type: 'group',
        title: 'Start here',
        icon: 'BoltIcon',
        pages: ['flow:CheckoutFlow', 'flow:PaymentRecoveryFlow'],
      },
      {
        type: 'group',
        title: 'E-Commerce domain',
        icon: 'Boxes',
        pages: ['domain:E-Commerce'],
      },
    ],
  },

  generators: [
    // The autotel-eventcatalog generator will go here once published.
    // Today the catalog is hand-curated to define the target output.
  ],
};
