const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildStandaloneHtml, escapeHtml } = require('../src/export-document');

test('escapeHtml protects the exported document title', () => {
  assert.equal(escapeHtml('A < B & "quoted"'), 'A &lt; B &amp; &quot;quoted&quot;');
});

test('buildStandaloneHtml includes rendered content, styles, and embedded KaTeX fonts', async () => {
  const appRoot = path.join(__dirname, '..');
  const result = await buildStandaloneHtml({
    title: '示例.md',
    html: '<h1>示例</h1><span class="katex">x</span>'
  }, appRoot);

  assert.match(result, /<title>示例\.md<\/title>/);
  assert.match(result, /<article class="markdown-body"><h1>示例<\/h1>/);
  assert.match(result, /data:font\/woff2;base64,/);
  assert.match(result, /default-src 'none'/);
});
