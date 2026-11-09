const { execFile } = require('node:child_process');
function detectWithPowerShell() {
  const command = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(codex|claude|claude-code)(\\.exe)?$' } | Select-Object Name,ProcessId,ExecutablePath | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) return resolve([]);
        try {
          const data = JSON.parse(stdout || '[]');
          resolve((Array.isArray(data) ? data : [data]).filter(Boolean).map((p) => ({
            name: p.Name, pid: p.ProcessId, path: p.ExecutablePath || null,
            agent: /^codex/i.test(p.Name) ? 'Codex' : 'Claude'
          })));
        } catch { resolve([]); }
      });
  });
}
function parseTasklist(stdout) {
  const result = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const cells = line.match(/"(?:[^"]|"")*"/g);
    if (!cells || cells.length < 2) continue;
    const name = cells[0].slice(1, -1).replace(/""/g, '"');
    const pid = Number(cells[1].slice(1, -1));
    if (!/^(codex|claude|claude-code)(\.exe)?$/i.test(name) || !Number.isSafeInteger(pid)) continue;
    result.push({ name, pid, path: null, agent: /^codex/i.test(name) ? 'Codex' : 'Claude' });
  }
  return result;
}
function detectProcesses() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) return detectWithPowerShell().then(resolve);
      resolve(parseTasklist(stdout));
    });
  });
}
module.exports = { detectProcesses, parseTasklist };
