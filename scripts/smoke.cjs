const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', '--smoke-test'], { cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: 'inherit' });
const timer = setTimeout(() => { console.error('Electron smoke timed out'); child.kill(); process.exitCode = 1; }, 240000);
child.on('exit', (code) => { clearTimeout(timer); process.exit(code ?? 1); });
