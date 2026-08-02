const fs = require('node:fs/promises');
const path = require('node:path');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fontMimeType(fileName) {
  if (fileName.endsWith('.woff2')) return 'font/woff2';
  if (fileName.endsWith('.woff')) return 'font/woff';
  return 'font/ttf';
}

async function inlineKatexFonts(css, fontsDirectory) {
  const fileNames = [...css.matchAll(/url\(fonts\/([^)]+)\)/g)].map((match) => match[1]);
  const uniqueFileNames = [...new Set(fileNames)];
  const replacements = new Map(await Promise.all(uniqueFileNames.map(async (fileName) => {
    const font = await fs.readFile(path.join(fontsDirectory, fileName));
    return [fileName, `data:${fontMimeType(fileName)};base64,${font.toString('base64')}`];
  })));
  return css.replace(/url\(fonts\/([^)]+)\)/g, (_match, fileName) => {
    return `url(${replacements.get(fileName)})`;
  });
}

async function buildStandaloneHtml({ html, title }, appRoot) {
  const [appCss, katexCssSource, highlightCss] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'styles.css'), 'utf8'),
    fs.readFile(path.join(appRoot, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf8'),
    fs.readFile(
      path.join(appRoot, 'node_modules', '@highlightjs', 'cdn-assets', 'styles', 'github.min.css'),
      'utf8'
    )
  ]);
  const katexCss = await inlineKatexFonts(
    katexCssSource,
    path.join(appRoot, 'node_modules', 'katex', 'dist', 'fonts')
  );
  const safeTitle = escapeHtml(title || 'Mori 文档');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; font-src data:">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>${katexCss}\n${highlightCss}\n${appCss}
  html, body { width: auto; height: auto; overflow: visible; background: #fff; }
  body { margin: 0; padding: 40px 56px; }
  .markdown-body { width: min(100%, 860px); min-height: 0; margin: 0 auto; padding: 0; }
  @page { size: A4; margin: 16mm; }
  @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <article class="markdown-body">${html}</article>
</body>
</html>`;
}

module.exports = { buildStandaloneHtml, escapeHtml, inlineKatexFonts };
