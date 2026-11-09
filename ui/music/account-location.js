(() => {
  'use strict';
  const button = document.getElementById('account-location-choose');
  const directory = document.getElementById('account-location-path');
  const status = document.getElementById('account-location-status');
  if (!button || !window.pulse?.accountLocation) return;
  function render(value) {
    directory.textContent = value.pendingDirectory || value.directory;
    status.textContent = value.error || (value.restartRequired ?
      '下次完整退出并重开时迁移，迁移完成前继续使用原目录。' :
      '登录信息使用本机加密保存；平台会话过期后需重新登录。');
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {render(await window.pulse.accountLocation('choose'));}
    catch (error) {status.textContent = error.message || '保存目录设置失败';}
    finally {button.disabled = false;}
  });
  window.pulse.accountLocation().then(render).catch(() => {directory.textContent = '账号目录暂时无法读取';});
})();
