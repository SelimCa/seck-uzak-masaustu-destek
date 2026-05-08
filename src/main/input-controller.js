const { spawn } = require('node:child_process');
const path = require('node:path');

class InputController {
  constructor() {
    this.process = null;
  }

  ensureRunning() {
    if (this.process && !this.process.killed) {
      return;
    }

    const scriptPath = path.join(__dirname, 'windows-input.ps1');
    this.process = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    this.process.on('exit', () => {
      this.process = null;
    });
  }

  send(payload) {
    this.ensureRunning();

    if (!this.process?.stdin?.writable) {
      return;
    }

    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
}

module.exports = {
  InputController,
};