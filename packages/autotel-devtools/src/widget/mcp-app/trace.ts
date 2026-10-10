// Entry for the `get_trace` MCP App view: the devtools waterfall, framed by a
// chat host. Runs in the host's sandboxed iframe, so there is no shadow root
// to isolate from: the stylesheet goes on the document itself.
import { mount } from 'svelte';
import cssText from './styles.css?inline';
import TraceApp from './TraceApp.svelte';

const style = document.createElement('style');
style.textContent = cssText;
document.head.append(style);
document.documentElement.dataset.theme = 'system';

const target = document.createElement('div');
document.body.style.margin = '0';
document.body.append(target);
mount(TraceApp, { target });
