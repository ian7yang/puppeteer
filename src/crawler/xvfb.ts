import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import { sleep } from './utils.js';

interface Options {
  displayNum?: number;
  timeout?: number;
  silent?: boolean;
  args?: string[];
  reuse?: boolean;
}

export default class Xvfb {
  displayNumber: number;
  timeout: number;
  silent: boolean;
  args: string[];
  reuse: boolean;
  process: ChildProcess | null;
  display: string;
  oldDisplay: string;
  constructor(options: Options) {
    this.displayNumber = options.displayNum || 98;
    this.reuse = options.reuse || false;
    this.silent = options.silent || false;
    this.timeout = options.timeout || 500;
    this.args = options.args || [];
    this.oldDisplay = '';
    this.process = null;
    let lockFile = this.lockFile(this.displayNumber);
    do {
      this.displayNumber++;
      lockFile = this.lockFile(this.displayNumber);
    } while (!this.reuse && fs.existsSync(lockFile));
    this.display = `:${this.displayNumber}`;
  }

  setDisplayEnvVar(): void {
    this.oldDisplay = process.env['DISPLAY'] || '';
    process.env['DISPLAY'] = this.display;
  }

  resetDisplayEnvVar(): void {
    process.env['DISPLAY'] = this.oldDisplay;
  }

  handlIO(data: unknown): void {
    if (!this.silent) {
      process?.stderr?.write(data as any);
    }
  }

  spawnProcess(
    lockFileExists: boolean,
    onAsyncSpawnError: (e: any) => void
  ): void {
    if (lockFileExists) {
      if (!this.reuse) {
        throw new Error(
          'Display ' +
            this.display +
            ' is already in use and the "reuse" option is false.'
        );
      }
    } else {
      this.process = spawn('Xvfb', [this.display, ...this.args]);
      this.process.stderr?.on('data', this.handlIO.bind(this));
      // Bind an error listener to prevent an error from crashing node.
      this.process.once('error', function (e) {
        onAsyncSpawnError(e);
      });
    }
  }

  async start(): Promise<ChildProcess> {
    if (!this.process) {
      const lockFile = this.lockFile();

      this.setDisplayEnvVar();
      this.spawnProcess(fs.existsSync(lockFile), function () {
        // Ignore async spawn error. While usleep is active, tasks on the
        // event loop cannot be executed, so spawn errors will never be
        // received during the startSync call.
      });

      let totalTime = 0;
      while (!fs.existsSync(lockFile)) {
        if (totalTime > this.timeout) {
          throw new Error('Could not start Xvfb.');
        }
        await sleep(10000);
        totalTime += 10;
      }
    }

    return this.process as ChildProcess;
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.killProcess();
      this.resetDisplayEnvVar();

      const lockFile = this.lockFile();
      let totalTime = 0;
      while (fs.existsSync(lockFile)) {
        if (totalTime > this.timeout) {
          throw new Error('Could not stop Xvfb.');
        }
        await sleep(10000);
        totalTime += 10;
      }
    }
  }

  lockFile(displayNum?: number): string {
    // displayNum = displayNum || this.display().toString().replace(/^:/, '');
    if (displayNum) {
      return `/tmp/.X${displayNum}-lock`;
    }
    return `/tmp/.X${this.display.replace(/^:/, '')}-lock`;
  }

  killProcess(): void {
    this.process?.kill();
    this.process = null;
  }
}
