'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {cleanCookies, publicProfile, authError} = require('./netease.cjs');
const MAX_FILE_BYTES = 128 * 1024;
function createAuthStore({dataDir, encryptString, decryptString, isEncryptionAvailable = () => false} = {}) {
  const file = dataDir ? path.join(dataDir, 'music-auth.json') : null;
  const available = () => {
    try { return Boolean(file && typeof encryptString === 'function' && typeof decryptString === 'function' && (typeof isEncryptionAvailable === 'function' ? isEncryptionAvailable() : isEncryptionAvailable)); } catch { return false; }
  };
  return {
    available,
    async load() {
      if (!available()) return null;
      try {
        const handle = await fs.open(file, 'r');
        let text;
        try {
          const buffer = Buffer.alloc(MAX_FILE_BYTES + 1), {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > MAX_FILE_BYTES) return null;
          text = buffer.subarray(0, bytesRead).toString('utf8');
        } finally { await handle.close(); }
        const envelope = JSON.parse(text);
        if (envelope.version !== 1 || typeof envelope.encrypted !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(envelope.encrypted)) return null;
        const decrypted = await decryptString(Buffer.from(envelope.encrypted, 'base64'));
        if (typeof decrypted !== 'string' || Buffer.byteLength(decrypted) > 48000) return null;
        const session = JSON.parse(decrypted), cookie = cleanCookies(session.cookie), profile = publicProfile(session.profile);
        return cookie.MUSIC_U ? {cookie, profile} : null;
      } catch { return null; }
    },
    async save(cookie, profile) {
      // A temporary OS encryption outage must not delete an earlier encrypted
      // session. Only explicit logout or a confirmed server rejection clears it.
      if (!available()) return false;
      const validated = cleanCookies(cookie), normalized = publicProfile(profile);
      if (!validated.MUSIC_U || !normalized) throw authError('STORAGE_FAILED', '登录资料未完整，无法安全保存');
      let temporary;
      try {
        const encrypted = await encryptString(JSON.stringify({cookie: validated, profile: normalized}));
        if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 64000) throw new Error();
        const payload = JSON.stringify({version: 1, encrypted: encrypted.toString('base64')});
        await fs.mkdir(path.dirname(file), {recursive: true});
        temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(payload, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, file); temporary = null;
        return true;
      } catch { throw authError('STORAGE_FAILED', '无法安全保存登录，请检查数据目录权限后重试'); }
      finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
    },
    async clear() {
      if (!file) return;
      try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw authError('STORAGE_FAILED', '无法清除本机登录记录，请检查数据目录权限后重试'); }
    }
  };
}
module.exports = {createAuthStore};
