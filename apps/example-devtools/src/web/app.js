import { init, setBaggage } from '/vendor/autotel-web/index.js';

const config = window.__SHOWCASE_CONFIG__;

const PERSONAS = {
  demo: {
    id: 'demo',
    name: 'Demo User',
    summary: 'Standard storefront customer with an active checkout-capable session.',
    token: 'demo-token',
    userId: 1,
    segment: 'growth',
  },
  alice: {
    id: 'alice',
    name: 'Alice Johnson',
    summary: 'VIP customer with prior order history and fast-path support treatment.',
    token: 'alice-token',
    userId: 2,
    segment: 'vip',
  },
  ops: {
    id: 'ops',
    name: 'Ops Analyst',
    summary: 'Internal persona for investigating reports and following worker job traces.',
    token: 'ops-token',
    userId: 3,
    segment: 'internal',
  },
};

const state = {
  persona: PERSONAS.demo,
  latestTraceId: null,
};

init({
  service: config.serviceNames.browser,
  endpoint: window.location.origin,
  debug: false,
  baggage: {
    initial: {
      'demo.surface': 'browser-showcase',
      'demo.stack': 'web-api-auth-worker-db',
    },
  },
});

function updateStatus(kind, text) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusText');
  dot.className = `status-dot${kind ? ` is-${kind}` : ''}`;
  label.textContent = text;
}

function updateTrace(traceId) {
  if (!traceId) return;
  state.latestTraceId = traceId;
  const link = document.getElementById('traceLink');
  link.textContent = `${traceId.slice(0, 10)}…`;
  link.href = `${config.devtoolsUrl}/#trace=${traceId}`;
  link.classList.remove('trace-link-empty');
}

function setResult(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function applyPersona(personaId) {
  state.persona = PERSONAS[personaId] ?? PERSONAS.demo;
  setBaggage({
    'tenant.id': 'showcase-store',
    'shop.persona': state.persona.id,
    'shop.segment': state.persona.segment,
  });

  document.getElementById('personaTitle').textContent = state.persona.name;
  document.getElementById('personaSummary').textContent = state.persona.summary;

  document.querySelectorAll('[data-persona]').forEach((button) => {
    button.classList.toggle(
      'is-active',
      button.getAttribute('data-persona') === state.persona.id,
    );
  });

  updateStatus(null, `Persona set to ${state.persona.name}.`);
}

document.querySelectorAll('[data-persona]').forEach((button) => {
  button.addEventListener('click', () => {
    applyPersona(button.getAttribute('data-persona'));
  });
});

async function apiCall(path, options = {}) {
  updateStatus('loading', `Running ${path}…`);

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.persona.token}`,
      ...(options.headers || {}),
    },
  });

  updateTrace(response.headers.get('x-trace-id'));
  const payload = await response.json();

  if (!response.ok) {
    updateStatus('error', `Request failed with ${response.status}.`);
    throw Object.assign(new Error(payload.message || 'Request failed'), {
      status: response.status,
      payload,
    });
  }

  updateStatus(null, `${path} completed.`);
  return payload;
}

window.browseProducts = async function browseProducts(category) {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  const data = await apiCall(`/api/products${query}`);
  setResult(
    'catalogResult',
    data.products
      .map(
        (product) =>
          `${product.name} — $${product.price}\n${product.stock} in stock · ${product.category}`,
      )
      .join('\n\n'),
  );
};

window.loadProfile = async function loadProfile() {
  const data = await apiCall(`/api/users/${state.persona.userId}`);
  const orders =
    data.profile.orders.length === 0
      ? 'No orders yet.'
      : data.profile.orders
          .map(
            (order) =>
              `Order #${order.id} — $${order.total} (${order.status}) with ${order.items.length} item(s)`,
          )
          .join('\n');
  const notifications =
    data.profile.notificationJobs.length === 0
      ? 'No notification jobs yet.'
      : data.profile.notificationJobs
          .map(
            (job) =>
              `Job #${job.id} — ${job.type} (${job.status})`,
          )
          .join('\n');

  setResult(
    'profileResult',
    [
      `${data.identity.name} <${data.identity.email}>`,
      `Segment: ${data.identity.segment}`,
      '',
      'Orders:',
      orders,
      '',
      'Notification jobs:',
      notifications,
    ].join('\n'),
  );
};

window.checkout = async function checkout() {
  const data = await apiCall('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({
      items: [
        { productId: 1, quantity: 1 },
        { productId: 4, quantity: 1 },
      ],
    }),
  });

  setResult(
    'checkoutResult',
    [
      data.message,
      `Order #${data.order.id} — $${data.order.total}`,
      `Worker job #${data.workerJob.jobId} — ${data.workerJob.status}`,
      '',
      ...data.recentJobs.map(
        (job) => `Notification job #${job.id}: ${job.type} (${job.status})`,
      ),
    ].join('\n'),
  );
};

window.runInventoryReport = async function runInventoryReport() {
  setResult('reportResult', 'Running recursive CTE report…');
  const data = await apiCall('/api/reports/inventory');
  setResult(
    'reportResult',
    [
      `Products: ${data.totalProducts}`,
      `Low stock: ${data.lowStock}`,
      `Inventory value: $${Math.round(data.totalValue).toLocaleString()}`,
      `Recursive count: ${data.recursiveCount.toLocaleString()}`,
    ].join('\n'),
  );
};

window.recommend = async function recommend(category, budget) {
  const data = await apiCall('/api/ai/recommend', {
    method: 'POST',
    body: JSON.stringify({ category, budget }),
  });
  setResult(
    'recommendationResult',
    [
      `Model: ${data.model}`,
      `Tokens: ${data.tokens.input} in / ${data.tokens.output} out`,
      '',
      ...data.recommendations.map(
        (item) => `${item.name} — $${item.price}\n${item.reason}`,
      ),
    ].join('\n\n'),
  );
};

window.support = async function support(question) {
  const data = await apiCall('/api/ai/support', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
  setResult(
    'supportResult',
    [
      `Model: ${data.model}`,
      `Confidence: ${Math.round(data.confidence * 100)}%`,
      `Tokens: ${data.tokens.input} in / ${data.tokens.output} out`,
      '',
      data.answer,
    ].join('\n'),
  );
};

window.triggerError = async function triggerError() {
  try {
    await apiCall('/api/error');
  } catch (error) {
    const payload = error.payload || {};
    setResult(
      'errorResult',
      [
        `Status: ${error.status || 'error'}`,
        `Message: ${payload.message || error.message}`,
        `Why: ${payload.why || 'n/a'}`,
        `Fix: ${payload.fix || 'n/a'}`,
        `Link: ${payload.link || 'n/a'}`,
      ].join('\n'),
    );
  }
};

applyPersona('demo');
setResult(
  'catalogResult',
  'Start with the featured catalog to create a browser-root trace.',
);
