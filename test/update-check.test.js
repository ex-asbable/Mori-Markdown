const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, getAvailableUpdate, parseSha256Sums } = require('../src/update-check');

function releaseAssets(version) {
  return [{
    name: `Mori-Markdown-Setup-${version}-x64.exe`,
    size: 1234,
    browser_download_url: `https://github.com/ex-asbable/Mori-Markdown/releases/download/v${version}/Mori-Markdown-Setup-${version}-x64.exe`
  }, {
    name: 'SHA256SUMS.txt',
    size: 256,
    browser_download_url: `https://github.com/ex-asbable/Mori-Markdown/releases/download/v${version}/SHA256SUMS.txt`
  }];
}

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
    prerelease: false,
    assets: releaseAssets('0.3.0')
  }), {
    version: '0.3.0',
    installer: {
      name: 'Mori-Markdown-Setup-0.3.0-x64.exe',
      size: 1234,
      url: 'https://github.com/ex-asbable/Mori-Markdown/releases/download/v0.3.0/Mori-Markdown-Setup-0.3.0-x64.exe'
    },
    checksums: {
      name: 'SHA256SUMS.txt',
      size: 256,
      url: 'https://github.com/ex-asbable/Mori-Markdown/releases/download/v0.3.0/SHA256SUMS.txt'
    }
  });

  assert.equal(getAvailableUpdate('0.3.0', {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0',
    assets: []
  }), null);
  assert.equal(getAvailableUpdate('0.2.3', {
    tag_name: 'v9.0.0',
    html_url: 'https://example.com/fake-release'
  }), null);
  assert.equal(getAvailableUpdate('0.2.3', {
    tag_name: 'v9.0.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v9.0.0',
    prerelease: true,
    assets: []
  }), null);

  assert.equal(getAvailableUpdate('0.2.3', {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0',
    draft: false,
    prerelease: false,
    assets: [{ ...releaseAssets('0.3.0')[0], browser_download_url: 'https://example.com/Mori-Markdown-Setup-0.3.0-x64.exe' }, releaseAssets('0.3.0')[1]]
  }), null);
});

test('requires one trusted checksum asset alongside the installer', () => {
  const release = {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/tag/v0.3.0',
    assets: releaseAssets('0.3.0')
  };
  assert.ok(getAvailableUpdate('0.2.3', release));
  assert.equal(getAvailableUpdate('0.2.3', { ...release, assets: [release.assets[0]] }), null);
  assert.equal(getAvailableUpdate('0.2.3', {
    ...release,
    assets: [{ ...release.assets[0] }, { ...release.assets[1], browser_download_url: 'https://github.com/ex-asbable/Mori-Markdown/releases/download/v0.3.0/SHA256SUMS.txt?cache=1' }]
  }), null);
});

test('parses only the requested SHA-256 entry from standard checksum output', () => {
  const digest = 'A'.repeat(64);
  const name = 'Mori-Markdown-Setup-0.3.0-x64.exe';
  assert.equal(parseSha256Sums(`${digest}  ${name}\r\n${'b'.repeat(64)}  other.exe\n`, name), digest.toLowerCase());
  assert.equal(parseSha256Sums(`${digest} *${name}\n`, name), digest.toLowerCase());
  assert.equal(parseSha256Sums(`${digest} ${name}\n`, name), null);
  assert.equal(parseSha256Sums(`${digest}  ${name}\n${'b'.repeat(64)}  ${name}\n`, name), null);
  assert.equal(parseSha256Sums('not a checksum', name), null);
});
