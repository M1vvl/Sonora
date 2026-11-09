'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const REPO = 'M1vvl/Sonora';
const MAX_BYTES = 400 * 1024 * 1024;
function newer(candidate, current) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) return false;
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}
function releaseAsset(release, current) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  if (release?.draft || release?.prerelease || !newer(version, current)) return null;
  const asset = release.assets?.find(item => item.name === `Sonara-${version}-Windows.exe`);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || asset.size < 1024 || asset.size > MAX_BYTES) return null;
  const url = new URL(asset.browser_download_url);
  if (url.origin !== 'https://github.com' || url.pathname !== `/${REPO}/releases/download/${release.tag_name}/${asset.name}`) return null;
  return {version, url: url.href, hash: asset.digest.slice(7), size: asset.size};
}
function createAppUpdates({app, fetchImpl, profileDirectory, executable = process.env.PORTABLE_EXECUTABLE_FILE} = {}) {
  let latest = null, checked = 0, checking = null, installing = null;
  const directory = path.join(profileDirectory, 'updates');
  const status = () => ({available: !!latest, version: latest?.version, supported: !!executable});
  async function check() {
    if (checking) return checking;
    if (checked && Date.now() - checked < 6 * 3600000) return status();
    checking = (async () => {
      const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'Sonara-Updater'}, signal: AbortSignal.timeout(15000)});
      if (response.status === 404) {latest = null; checked = Date.now(); return status();}
      if (!response.ok) throw new Error('版本检查暂时不可用');
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new Error('版本信息过大');
      latest = releaseAsset(JSON.parse(text), app.getVersion());
      checked = Date.now();
      return status();
    })().finally(() => {checking = null;});
    return checking;
  }
  async function install() {
    if (installing) return installing;
    installing = (async () => {
      if (!latest || !executable || !path.isAbsolute(executable) || !/\.exe$/i.test(executable)) throw new Error('请使用 Sonara 单文件版进行更新');
      await fs.mkdir(directory, {recursive: true});
      const id = crypto.randomBytes(16).toString('hex');
      const download = path.join(directory, id + '.exe');
      const expected = {...latest};
      const response = await fetchImpl(expected.url, {signal: AbortSignal.timeout(10 * 60000)});
      if (!response.ok || !response.body) throw new Error('更新下载失败');
      const file = await fs.open(download, 'wx');
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > expected.size || bytes > MAX_BYTES) throw new Error('更新文件大小异常');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
        if (bytes !== expected.size || hash.digest('hex') !== expected.hash) throw new Error('更新文件校验失败');
      } catch (error) {
        await response.body.cancel?.().catch(() => {});
        await file.close();
        await fs.unlink(download).catch(() => {});
        throw error;
      }
      await file.close();
      const target = path.resolve(executable);
      await fs.access(path.dirname(target), require('node:fs').constants.W_OK);
      const job = path.join(directory, id + '.json');
      await fs.writeFile(job, JSON.stringify({pid: process.pid, target, download,
        backup: target + '.previous', hash: expected.hash, id,
        receipt: path.join(directory, 'receipt-' + id + '.json')}), {mode: 0o600});
      const helper = path.join(directory, 'apply-update.ps1');
      await fs.copyFile(path.join(__dirname, 'apply-update.ps1'), helper);
      const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-JobFile',job],
        {detached: true, windowsHide: true, stdio: 'ignore'});
      await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
      child.unref();
      app.quit();
      return {installing: true};
    })().catch(error => {installing = null; throw error;});
    return installing;
  }
  return {check, install, status};
}
module.exports = {createAppUpdates, releaseAsset, newer};
