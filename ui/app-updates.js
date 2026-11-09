(() => {
  'use strict';
  const button = document.getElementById('app-update-button');
  if (!button || !window.pulse?.appUpdate) return;
  let busy = false;
  async function check() {
    if (busy) return;
    try {
      const value = await window.pulse.appUpdate('check');
      button.hidden = !value.available;
      button.title = value.supported ? '更新到 Sonara ' + value.version : '新版可用，请使用单文件版更新';
      button.disabled = !value.supported;
    } catch {}
  }
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.title = '正在下载并校验更新';
    try {await window.pulse.appUpdate('install');}
    catch (error) {
      button.title = error.message || '更新失败，点击重试';
      const toast = document.getElementById('toast');
      if (toast) {toast.textContent = button.title; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 5000);}
      button.disabled = false;
      busy = false;
    }
  });
  setTimeout(check, 5000);
  const timer = setInterval(check, 6 * 3600000);
  window.addEventListener('beforeunload', () => clearInterval(timer), {once: true});
})();
