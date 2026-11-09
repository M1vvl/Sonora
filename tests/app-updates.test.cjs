'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {releaseAsset, newer} = require('../src/app-updates.cjs');
const release = () => ({tag_name: 'v0.3.42', assets: [{name: 'Sonara-0.3.42-Windows.exe',
  size: 150000000, digest: 'sha256:' + 'a'.repeat(64),
  browser_download_url: 'https://github.com/M1vvl/Sonora/releases/download/v0.3.42/Sonara-0.3.42-Windows.exe'}]});
test('updater accepts only a newer stable repository asset with a trusted SHA256 digest', () => {
  assert(newer('0.4.0', '0.3.99'));
  assert(!newer('0.3.9', '0.3.41'));
  assert.equal(releaseAsset(release(), '0.3.41').version, '0.3.42');
  assert.equal(releaseAsset(release(), '0.3.42'), null);
  for (const change of [value => value.prerelease = true, value => value.assets[0].digest = '',
    value => value.assets[0].size = 800000000,
    value => value.assets[0].browser_download_url = 'https://github.com/other/repo/evil.exe']) {
    const value = release(); change(value);
    assert.equal(releaseAsset(value, '0.3.41'), null);
  }
});
