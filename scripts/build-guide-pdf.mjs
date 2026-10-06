// Regenerates site/assets/downloads/Als-Playground-RBR-Car-Setup-Guide.pdf from site/guide/index.html.
// Needs Playwright with Chromium installed (not a project dependency). Run after editing the guide:
//   node scripts/build-guide-pdf.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, 'site/guide/index.html')).href);
await page.pdf({
  path: path.join(root, 'site/assets/downloads/Als-Playground-RBR-Car-Setup-Guide.pdf'),
  format: 'Letter', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font:8px sans-serif;color:#5F5E5A;padding:0 0.6in;display:flex;justify-content:space-between"><span>Al\'s Playground · Richard Burns Rally car setup guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('Wrote the guide PDF');
