// Records the README/docs media from the running showcase (`pnpm start` first).
// Writes apps/docs/public/media: devtools-demo.{mp4,gif}, devtools-trace.png,
// devtools-service-map.png and social-preview.png (1280x640). Needs ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { showCursor } from 'executable-stories-showcase/playwright';

const WEB = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:3000';
const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
const OUT = join(docs, 'public/media');
const size = { width: 1280, height: 800 };
const ffmpeg = (...args) =>
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

const browser = await chromium.launch();

// Earlier traffic, so the dashboard and service map are not empty. Not recorded.
const warm = await browser.newPage();
await warm.goto(WEB);
for (const name of [
  'Featured catalog',
  'Load active persona',
  'Run slow report',
  'Run checkout',
  'Books',
]) {
  await warm.getByRole('button', { name, exact: true }).click();
  await warm.waitForTimeout(400);
}
await warm.close();

const videoDir = mkdtempSync(join(tmpdir(), 'autotel-media-'));
const ctx = await browser.newContext({
  viewport: size,
  recordVideo: { dir: videoDir, size },
});
const page = await ctx.newPage();
await showCursor(page, { glide: 500 });
await page.goto(WEB);
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Run checkout' }).click();
const link = page.locator('#traceLink:not(.trace-link-empty)');
await link.waitFor();
await page.waitForTimeout(1200);
await link.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await link.hover();
// The services' batch exporters flush after a few seconds; open the trace once it is whole.
await page.waitForTimeout(4500);
const traceUrl = await link.getAttribute('href');
await page.goto(traceUrl);
await page.waitForTimeout(3200);
await page.getByText('Service Map', { exact: true }).first().click();
await page.waitForTimeout(2800);
await ctx.close();

// Stills at 2x, without the drawn cursor.
const stills = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
await stills.goto(traceUrl);
await stills.waitForTimeout(2500);
await stills.screenshot({ path: join(OUT, 'devtools-trace.png') });
await stills.getByText('Service Map', { exact: true }).first().click();
await stills.waitForTimeout(2500);
await stills.mouse.move(size.width - 10, size.height - 10);
await stills.screenshot({ path: join(OUT, 'devtools-service-map.png') });
await stills.close();

const fonts = join(docs, 'node_modules');
const card = await browser.newPage({ viewport: { width: 1280, height: 640 } });
// A file page, so the card can load the fonts and screenshot from disk.
const cardFile = join(videoDir, 'card.html');
writeFileSync(
  cardFile,
  `<!doctype html><style>
@font-face{font-family:JBM;src:url(file://${fonts}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2);font-weight:700}
@font-face{font-family:JBM;src:url(file://${fonts}/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2);font-weight:500}
@font-face{font-family:Inter;src:url(file://${fonts}/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2);font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:640px;background:#08090a;color:#f7f8f8;font-family:Inter;overflow:hidden;position:relative}
.copy{position:absolute;left:72px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center;gap:28px}
.eyebrow{font:500 15px JBM;letter-spacing:.2em;text-transform:uppercase;color:#8a8f98}
h1{font:700 104px/1 JBM;letter-spacing:-.04em} h1 span{color:#3b82f6}
p{font-size:30px;line-height:1.3;color:#d0d6e0;font-weight:500}
code{font:500 20px JBM;color:#60a5fa;background:#161718;border:1px solid #23252a;border-radius:10px;padding:14px 18px;align-self:flex-start}
.shot{position:absolute;left:650px;top:72px;width:900px;border-radius:14px;border:1px solid #323334;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.shot img{display:block;width:1150px;margin-left:-172px}
</style>
<div class="copy">
  <div class="eyebrow">OpenTelemetry · TypeScript</div>
  <h1>autotel<span>_</span></h1>
  <p>Wrap a function. Get traces, metrics, logs and events in any OTLP backend.</p>
  <code>npm install autotel</code>
</div>
<div class="shot"><img src="file://${join(OUT, 'devtools-trace.png')}"></div>`,
);
await card.goto(`file://${cardFile}`);
await card.evaluate(() => document.fonts.ready);
await card.screenshot({ path: join(OUT, 'social-preview.png') });
await browser.close();

const [webm] = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
const video = join(videoDir, webm);
// -ss 0.8 drops the blank frames before the first paint.
ffmpeg(
  '-ss',
  '0.8',
  '-i',
  video,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '26',
  '-preset',
  'slow',
  '-movflags',
  '+faststart',
  '-an',
  join(OUT, 'devtools-demo.mp4'),
);
ffmpeg(
  '-ss',
  '0.8',
  '-i',
  video,
  '-vf',
  'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  '-loop',
  '0',
  join(OUT, 'devtools-demo.gif'),
);
rmSync(videoDir, { recursive: true });
console.log(`Wrote media to ${OUT}`);
