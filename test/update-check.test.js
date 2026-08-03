const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, getAvailableUpdate } = require('../src/update-check');

test('compares semantic versions including prereleases', () => {
  assert.equal(compareVersions('v0.3.0', '0.2.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('not-a-version', '1.0.0'), null);
});

test('accepts only a newer stable release from the expected GitHub repository', () => {
  assert.deepEqual(getAvailableUpdate('0.2.3', {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0',
    draft: false,
    prerelease: false
  }), {
    version: '0.3.0',
    url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0'
  });

  assert.equal(getAvailableUpdate('0.3.0', {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0'
  }), null);
  assert.equal(getAvailableUpdate('0.2.3', {
    tag_name: 'v9.0.0',
    html_url: 'https://example.com/fake-release'
  }), null);
  assert.equal(getAvailableUpdate('0.2.3', {
    tag_name: 'v9.0.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v9.0.0',
    prerelease: true
  }), null);
});
