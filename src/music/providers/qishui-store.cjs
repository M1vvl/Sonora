'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Only this application's Passport session and generated device identity.
// The Chromium session and the additional record both use OS encryption.
function createQishuiStore({dataDir,safeStorage} = {}) {
  const file = dataDir ? path.join(dataDir,'music-qishui-auth.json') : null;
  let current = {};
  const available = () => Boolean(file && safeStorage?.isEncryptionAvailable?.());
  function clean(value) {
    const out = {};
    for (const name of ['deviceId','installId','verifyPortraitId','computerName','cookie','msToken']) {
      if (typeof value?.[name] === 'string' && value[name].length <= (name === 'cookie' ? 24000 : 256)) out[name] = value[name];
    }
    return out;
  }
  if (available()) {
    try {
      if (fs.statSync(file).size <= 64000) {
        const envelope = JSON.parse(fs.readFileSync(file,'utf8'));
        if (envelope.version === 1 && /^[A-Za-z0-9+/]+=*$/.test(envelope.encrypted || '')) {
          const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64'));
          if (decrypted.length <= 32000) current = clean(JSON.parse(decrypted));
        }
      }
    } catch {}
  }
  return {
    read: () => ({...current}),
    save(patch) {
      current = clean({...current,...patch});
      if (!available()) return false;
      const encrypted = safeStorage.encryptString(JSON.stringify(current));
      const payload = JSON.stringify({version:1,encrypted:encrypted.toString('base64')});
      const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      fs.mkdirSync(path.dirname(file),{recursive:true});
      try {fs.writeFileSync(temporary,payload,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
      finally {try {fs.unlinkSync(temporary);} catch {}}
      return true;
    },
    clear() {
      current = {};
      if (file) try {fs.unlinkSync(file);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  };
}
module.exports = {createQishuiStore};
