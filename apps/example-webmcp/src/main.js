// autotel-webmcp/core: the instrumentation with no telemetry dependency, so
// this page loads straight into the browser with no bundler. The default entry
// wires autotel-web's span() in and reaches the OpenTelemetry browser SDK,
// which needs a bundler like any other app dependency.
import { instrumentWebMCP } from '../../../packages/autotel-webmcp/dist/core.js';

const supportEl = document.querySelector('#support');
const spansEl = document.querySelector('#spans');
const toolsEl = document.querySelector('#tools');
const captureEl = document.querySelector('#capture');
const captureNoteEl = document.querySelector('#capture-note');

// ---------------------------------------------------------------- spans

// instrumentWebMCP() takes a span factory, so the demo renders spans on
// the page instead of needing a collector. Swap this for autotel-web's
// span() and the same spans go to devtools or any OTLP backend.
const rendered = [];

function renderingSpan(name, fn) {
  const entry = { name, attributes: {}, error: undefined };
  rendered.unshift(entry);
  const api = {
    setAttribute: (key, value) => {
      entry.attributes[key] = value;
      draw();
    },
    end: () => {},
  };
  const fail = (error) => {
    entry.error = error instanceof Error ? error.message : String(error);
    draw();
    throw error;
  };
  try {
    const result = fn(api);
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).catch(fail);
    }
    draw();
    return result;
  } catch (error) {
    fail(error);
  }
}

const escape = (value) =>
  String(value).replaceAll(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

function draw() {
  if (rendered.length === 0) {
    spansEl.innerHTML =
      '<p class="px-5 py-6 text-sm text-slate-500">No spans yet. Call a tool above.</p>';
    return;
  }
  spansEl.innerHTML = rendered
    .map((entry) => {
      const rows = Object.entries(entry.attributes)
        .map(
          ([key, value]) =>
            `<div class="flex gap-3 py-0.5"><code class="w-72 shrink-0 font-mono text-xs text-slate-500">${escape(key)}</code><code class="font-mono text-xs break-all">${escape(value)}</code></div>`,
        )
        .join('');
      const badge = entry.error
        ? '<span class="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">threw</span>'
        : '';
      const failure = entry.error
        ? `<p class="mt-2 text-xs text-red-700">${escape(entry.error)}</p>`
        : '';
      return `<div class="px-5 py-4"><div class="mb-2 flex items-center gap-2"><span class="font-mono text-sm font-semibold">${escape(entry.name)}</span>${badge}</div>${rows}${failure}</div>`;
    })
    .join('');
}

document.querySelector('#clear').addEventListener('click', () => {
  rendered.length = 0;
  draw();
});

// ---------------------------------------------------------------- tools

const tools = [
  {
    name: 'search',
    description: 'Search the product catalogue',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: false,
      // Chrome drops these two without saying so.
      idempotentHint: true,
      destructiveHint: false,
    },
    execute: ({ query }) =>
      JSON.stringify([
        { id: 'sku-1', title: `Blue mug matching "${query}"`, price: 12 },
        { id: 'sku-2', title: 'Green mug', price: 14 },
      ]),
    sample: { query: 'mug' },
  },
  {
    name: 'clear_cart',
    description: 'Empty the shopping cart',
    inputSchema: { type: 'object', properties: {} },
    execute: () => '',
    sample: {},
  },
  {
    name: 'describe_order',
    description: 'Describe an order in MCP envelope form',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
    },
    execute: ({ orderId }) => ({
      content: [{ type: 'text', text: `Order ${orderId} ships Tuesday.` }],
    }),
    sample: { orderId: 'A-1179' },
  },
  {
    name: 'checkout',
    description: 'Place the order',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        cardLast4: { type: 'string' },
      },
    },
    execute: () => {
      // A tool library catches the failure and hands the agent prose,
      // which is right for the agent and invisible to telemetry unless
      // the instrumentation is told how to recognise it.
      try {
        throw new Error('Card declined');
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },
    sample: { address: '14 Bridge St, Bristol', cardLast4: '4242' },
  },
];

// ---------------------------------------------------------- instrument

let handle;

function install() {
  handle?.uninstall();
  handle = instrumentWebMCP({
    span: renderingSpan,
    capturePayloads: captureEl.checked,
    isErrorResult: (value) =>
      typeof value === 'string' && value.startsWith('Error: '),
  });
  captureNoteEl.textContent = captureEl.checked
    ? 'Capturing. The checkout tool sends a postal address — that is now on the span.'
    : 'Not capturing. Size, type, envelope and substitution are still recorded.';
}

// Registration lasts as long as this controller. Aborting it unregisters
// every tool, which is how the capture toggle re-registers without
// colliding with the names already taken.
let registration;

async function register() {
  registration?.abort();
  registration = new AbortController();
  for (const tool of tools) {
    const { sample, ...definition } = tool;
    await document.modelContext.registerTool(definition, {
      signal: registration.signal,
    });
  }
}

async function run(tool) {
  const registered = (await document.modelContext.getTools()).find(
    (candidate) => candidate.name === tool.name,
  );
  // Chrome takes the input as a JSON string, not as the object the
  // draft specifies.
  await document.modelContext.executeTool(
    registered,
    JSON.stringify(tool.sample),
  );
}

function drawToolButtons() {
  toolsEl.innerHTML = '';
  for (const tool of tools) {
    const button = document.createElement('button');
    button.className =
      'rounded bg-slate-900 px-3 py-2 font-mono text-sm text-white hover:bg-slate-700';
    button.textContent = tool.name;
    button.addEventListener('click', () => {
      run(tool).catch((error) => {
        console.error(error);
      });
    });
    toolsEl.append(button);
  }
}

// --------------------------------------------------------------- start

if (globalThis.document?.modelContext) {
  supportEl.className =
    'mb-8 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm';
  supportEl.innerHTML =
    '<strong>WebMCP is available.</strong> Four tools are registered below. Registration spans are already in the list.';
  // Capture is decided when a tool's execute is wrapped, so changing it
  // means registering the tools again.
  captureEl.addEventListener('change', async () => {
    install();
    rendered.length = 0;
    draw();
    await register();
  });
  install();
  drawToolButtons();
  await register();
} else {
  supportEl.className =
    'mb-8 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm';
  supportEl.innerHTML =
    '<strong>No <code class="font-mono">document.modelContext</code> in this browser.</strong> ' +
    'WebMCP ships in Chrome 151 behind <code class="font-mono">chrome://flags/#web-machine-learning-model-context</code>. ' +
    '<code class="font-mono">instrumentWebMCP()</code> returned a no-op handle rather than throwing, which is the same thing it does during server rendering.';
  toolsEl.innerHTML =
    '<p class="text-sm text-slate-500">Tools need WebMCP.</p>';
  captureEl.disabled = true;
}
