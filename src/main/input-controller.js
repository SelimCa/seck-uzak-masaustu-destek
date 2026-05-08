const { spawn } = require('node:child_process');
const path = require('node:path');

class InputController {
  constructor() {
    this.process = null;
    this.isBroken = false;
  }

  ensureRunning() {
    if (this.process && !this.process.killed && !this.isBroken) {
      return;
    }

    const scriptPath = path.join(__dirname, 'windows-input.ps1');
    this.isBroken = false;
    this.process = spawn('powershell.exe', [
      '-NoProfile',
      '-Sta',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    this.process.stdin.on('error', () => {
      this.isBroken = true;
    });

    this.process.on('error', () => {
      this.isBroken = true;
      this.process = null;
    });

    this.process.on('exit', () => {
      this.isBroken = true;
      this.process = null;
    });
  }

  send(payload) {
    this.ensureRunning();

    if (!this.process?.stdin?.writable) {
      return false;
    }

    try {
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    }
    catch {
      this.isBroken = true;
      this.process = null;
      return false;
    }
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = null;
    this.isBroken = false;
  }
}

module.exports = {
  InputController,
};