'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Credentials retain their existing OS encryption. Directory changes are
// committed at next startup, before any music/browser session can hold a lock.
function createAccountLocation(profileDirectory) {
  const file = path.join(profileDirectory, 'music-account-location.json');
  let config = {active: null, pending: null};
  let error = '';
  const owner = crypto.createHash('sha256').update(os.homedir() + '|' + os.hostname()).digest('hex').slice(0, 16);
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  };
  async function write(value) {
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(value), {mode: 0o600});
    await fs.rename(temporary, file);
    config = value;
  }
  function status() {
    return {directory: config.active || path.join(profileDirectory, 'music'),
      pendingDirectory: config.pending, restartRequired: !!config.pending, error};
  }
  async function initialize() {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      config = {active: typeof saved.active === 'string' && path.isAbsolute(saved.active) ? saved.active : null,
        pending: typeof saved.pending === 'string' && path.isAbsolute(saved.pending) ? saved.pending : null};
    } catch {}
    if (!config.pending) return status();
    const destination = config.pending;
    const staging = destination + '.migration';
    try {
      if (await fs.readFile(path.join(destination, '.migration-complete'), 'utf8').catch(() => '') === owner) {
        await write({active: destination, pending: null});
        return status();
      }
      if (await fs.lstat(destination).catch(() => null)) throw new Error('目标账号目录已存在，请重新选择保存文件夹');
      if (config.active && contains(config.active, destination)) throw new Error('目标目录不能位于当前账号目录内');
      // Keep the original copy until the complete destination is committed.
      const source = config.active || path.join(profileDirectory, 'music');
      await fs.mkdir(staging, {recursive: true});
      const filter = sourcePath => !['Cache','Code Cache','GPUCache','DawnCache','ShaderCache','GrShaderCache',
        'SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort'].includes(path.basename(sourcePath));
      try {await fs.cp(source, path.join(staging, 'music'), {recursive: true, filter});}
      catch (failure) {if (failure.code !== 'ENOENT') throw failure;}
      const partitions = config.active ? path.join(config.active, 'sessions') : path.join(profileDirectory, 'Partitions');
      await fs.mkdir(path.join(staging, 'sessions'), {recursive: true});
      for (const provider of ['qq','kugou','qishui','spotify']) {
        const name = config.active ? provider : 'agent-pulse-' + provider + '-official';
        try {await fs.cp(path.join(partitions, name), path.join(staging, 'sessions', provider), {recursive: true, filter});}
        catch (failure) {if (failure.code !== 'ENOENT') throw failure;}
      }
      await fs.writeFile(path.join(staging, '.migration-complete'), owner, {mode: 0o600});
      await fs.rename(staging, destination);
      await write({active: destination, pending: null});
    } catch (failure) {
      error = '账号目录迁移未完成，继续使用原目录。' + failure.message;
    }
    return status();
  }
  async function select(parent, applicationDirectory) {
    const base = path.resolve(parent);
    const destination = path.join(base, 'Sonara-Accounts-' + owner, crypto.randomBytes(4).toString('hex'));
    if (contains(applicationDirectory, base) || contains(profileDirectory, base) ||
        (config.active && contains(config.active, base))) {
      throw new Error('请选择软件、源码和当前账号目录之外的私人文件夹');
    }
    await fs.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
    if (process.platform === 'win32') {
      const {execFileSync} = require('node:child_process');
      const identity = execFileSync('whoami.exe', [], {encoding: 'utf8', windowsHide: true}).trim();
      execFileSync('icacls.exe', [path.dirname(destination), '/inheritance:r', '/grant:r',
        identity + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], {windowsHide: true, stdio: 'pipe'});
    }
    const probe = destination + '.write-test';
    await fs.writeFile(probe, '', {flag: 'wx', mode: 0o600});
    await fs.unlink(probe);
    await write({...config, pending: destination});
    return status();
  }
  function musicDirectory() {return config.active ? path.join(config.active, 'music') : path.join(profileDirectory, 'music');}
  function officialSession(session, provider) {
    return config.active ? session.fromPath(path.join(config.active, 'sessions', provider), {cache: false}) :
      session.fromPartition('persist:agent-pulse-' + provider + '-official', {cache: false});
  }
  return {initialize, select, status, musicDirectory, officialSession};
}

module.exports = {createAccountLocation};
