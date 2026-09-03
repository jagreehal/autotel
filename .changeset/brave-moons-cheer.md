---
'autotel-playwright': minor
'autotel-web': minor
---

Observe a browser session, and tell automated sessions apart from people's.

`withBrowserSession()` (`autotel-playwright/session`) wraps a Playwright
`BrowserContext` in one `browser.session` span and records what the session
cost: `browser.session.cpu.time`, `.memory.usage`, `.network.io`, `.pages` and
`.console.errors`, with console output as `browser.console` events and every
uncaught page exception on the span. It takes a `BrowserContext` rather than a
test fixture, so agents and scrapers driving a browser in production get the
same view, exported to whatever backend `init()` already points at. The span is
active for the callback, so work started inside it joins the trace.

`autotel-web` now sets `user_agent.synthetic.type: 'test'` on the resource when
`navigator.webdriver` is set, which every browser automation framework does.
Segment on it to keep automated sessions in their own panels.
