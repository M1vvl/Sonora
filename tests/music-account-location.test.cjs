'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createAccountLocation} = require('../src/music/account-location.cjs');

test('account storage changes only on restart and migrates encrypted data plus official sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sonara-account-location-'));
  try {
    const profile = path.join(root, 'profile');
    await fs.mkdir(path.join(profile, 'music'), {recursive: true});
    await fs.writeFile(path.join(profile, 'music/music-auth.json'), '{"encrypted":"synthetic-cipher"}');
    await fs.mkdir(path.join(profile, 'Partitions/agent-pulse-qq-official/Network'), {recursive: true});
    await fs.writeFile(path.join(profile, 'Partitions/agent-pulse-qq-official/Network/Cookies'), 'synthetic-protected-cookie');
    const location = createAccountLocation(profile);
    await location.initialize();
    const selected = await location.select(path.join(root, 'private'), path.join(root, 'application'));
    assert.equal(location.musicDirectory(), path.join(profile, 'music'));
    assert(selected.restartRequired);
    const restarted = createAccountLocation(profile);
    const status = await restarted.initialize();
    assert.equal(status.error, '');
    assert.equal(status.restartRequired, false);
    assert.equal(status.directory, selected.pendingDirectory);
    assert.equal(await fs.readFile(path.join(restarted.musicDirectory(), 'music-auth.json'), 'utf8'), '{"encrypted":"synthetic-cipher"}');
    assert.equal(await fs.readFile(path.join(status.directory, 'sessions/qq/Network/Cookies'), 'utf8'), 'synthetic-protected-cookie');
    assert.equal(await fs.readFile(path.join(profile, 'music/music-auth.json'), 'utf8'), '{"encrypted":"synthetic-cipher"}');
    const paths = [];
    restarted.officialSession({fromPath(directory) {paths.push(directory);}}, 'qq');
    assert.equal(paths[0], path.join(status.directory, 'sessions/qq'));
    await assert.rejects(restarted.select(path.join(root, 'application/data'), path.join(root, 'application')));
    const again = createAccountLocation(profile);
    await again.initialize();
    assert.equal(again.musicDirectory(), restarted.musicDirectory());
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('a failed migration leaves the previously saved account directory available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sonara-account-rollback-'));
  try {
    const profile = path.join(root, 'profile');
    await fs.mkdir(profile);
    const location = createAccountLocation(profile);
    const selected = await location.select(path.join(root, 'private'), path.join(root, 'application'));
    await fs.writeFile(selected.pendingDirectory, 'destination-conflict');
    const restarted = createAccountLocation(profile);
    const result = await restarted.initialize();
    assert(result.error);
    assert.equal(restarted.musicDirectory(), path.join(profile, 'music'));
    assert.equal(result.pendingDirectory, selected.pendingDirectory);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});
