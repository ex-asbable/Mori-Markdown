const https = require('node:https');

const latestReleaseUrl = new URL('https://api.github.com/repos/ex-asbable/Mori-Markdown/releases/latest');
const maximumResponseBytes = 64 * 1024;
const repositoryPath = '/ex-asbable/Mori-Markdown';

function getReleaseAsset(release, name, version) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const matches = assets.filter((candidate) => candidate?.name === name);
  if (matches.length !== 1) return null;

  const asset = matches[0];
  if (typeof asset.browser_download_url !== 'string' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    return null;
  }

  let downloadUrl;
  try {
    downloadUrl = new URL(asset.browser_download_url);
  } catch {
    return null;
  }
  const expectedPath = `${repositoryPath}/releases/download/v${version}/${name}`;
  if (
    downloadUrl.protocol !== 'https:' ||
    downloadUrl.hostname !== 'github.com' ||
    downloadUrl.port ||
    downloadUrl.username ||
    downloadUrl.password ||
    downloadUrl.search ||
    downloadUrl.hash ||
    downloadUrl.pathname !== expectedPath
  ) {
    return null;
  }
  return Object.freeze({ name, url: downloadUrl.href, size: asset.size });
}

function getInstallerAsset(release, version) {
  const name = `Mori-Markdown-Setup-${version}-x64.exe`;
  return getReleaseAsset(release, name, version);
}

function getChecksumsAsset(release, version) {
  return getReleaseAsset(release, 'SHA256SUMS.txt', version);
}

function parseSha256Sums(contents, expectedName) {
  if (typeof contents !== 'string' || typeof expectedName !== 'string' || !expectedName) return null;

  let checksum = null;
  for (let line of contents.split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '');
    // sha256sum emits "<digest><two spaces><filename>" for text files and
    // "<digest><space>*<filename>" for binary files.
    const match = line.match(/^([a-fA-F0-9]{64}) (?: |\*)(.+)$/);
    if (!match || match[2] !== expectedName) continue;
    if (checksum !== null) return null;
    checksum = match[1].toLowerCase();
  }
  return checksum;
}

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => BigInt(part)),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] > right.core[index]) return 1;
    if (left.core[index] < right.core[index]) return -1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftPart) > BigInt(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function getAvailableUpdate(currentVersion, release) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;
  const tagName = release.tag_name;
  if (compareVersions(tagName, currentVersion) !== 1) return null;

  let releaseUrl;
  try {
    releaseUrl = new URL(release.html_url);
  } catch {
    return null;
  }
  const version = tagName.trim().replace(/^v/i, '');
  if (
    releaseUrl.protocol !== 'https:' ||
    releaseUrl.hostname !== 'github.com' ||
    releaseUrl.port ||
    releaseUrl.username ||
    releaseUrl.password ||
    releaseUrl.search ||
    releaseUrl.hash ||
    releaseUrl.pathname !== `${repositoryPath}/releases/tag/v${version}`
  ) {
    return null;
  }

  const installer = getInstallerAsset(release, version);
  const checksums = getChecksumsAsset(release, version);
  if (!installer || !checksums) return null;

  return Object.freeze({ version, installer, checksums });
}

function fetchLatestRelease({ currentVersion, timeoutMs = 5000, get = https.get }) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = get(latestReleaseUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Mori-Markdown/${currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub returned HTTP ${response.statusCode}`));
          return;
        }

        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body, 'utf8') > maximumResponseBytes) {
            response.destroy(new Error('GitHub response was too large'));
          }
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve(getAvailableUpdate(currentVersion, JSON.parse(body)));
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      reject(error);
      return;
    }

    request.setTimeout(timeoutMs, () => request.destroy(new Error('Update check timed out')));
    request.on('error', reject);
  });
}

module.exports = {
  compareVersions,
  fetchLatestRelease,
  getAvailableUpdate,
  getInstallerAsset,
  getChecksumsAsset,
  parseSha256Sums
};
