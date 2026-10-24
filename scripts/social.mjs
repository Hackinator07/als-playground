// Adds link-preview tags (Open Graph and Twitter) to a built page, so a shared link shows a title, text and image.
// The title and description are read from the page's own <title> and <meta name="description">.

export const SITE_URL = (process.env.SITE_URL || 'https://hackinator07.github.io/als-playground').replace(/\/+$/, '');
const SITE_NAME = "Al's Playground";
const IMAGE = 'assets/img/preview.png';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** relPath: the page's path inside the site, such as "index.html" or "tunes/ab12cd34/index.html". */
export function injectSocial(html, relPath) {
  if (/property="og:title"/.test(html)) return html;
  const title = /<title>([^<]*)<\/title>/.exec(html);
  const desc = /<meta name="description" content="([^"]*)"/.exec(html);
  if (!title) return html;
  const dir = relPath.replace(/index\.html$/, '');
  const url = `${SITE_URL}/${dir}`;
  const t = unesc(title[1]);
  const d = desc ? unesc(desc[1]) : '';
  const tags = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:title" content="${esc(t)}">`,
    d ? `<meta property="og:description" content="${esc(d)}">` : '',
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${SITE_URL}/${IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(SITE_NAME)}: Richard Burns Rally stage times">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(t)}">`,
    d ? `<meta name="twitter:description" content="${esc(d)}">` : '',
    `<meta name="twitter:image" content="${SITE_URL}/${IMAGE}">`,
  ].filter(Boolean).map((l) => `  ${l}`).join('\n');
  return html.replace('</head>', `${tags}\n</head>`);
}
