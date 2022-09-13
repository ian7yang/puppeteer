import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import puppeteer from '../puppeteer-core.js';
import {
  BrowserLaunchArgumentOptions,
  Browser,
  Target,
  Device,
} from '../api-docs-entry.js';
import { g, url2str } from './utils.js';
import Crawler from './crawler.js';
import { getConsoleLogger } from './logger.js';

const logger = getConsoleLogger('manager');

interface SELog {
  log: string;
}

export default class Manager {
  debug: boolean;
  browser: Browser | null;
  CRAWLER_LOG_DIR: string;
  FORENSIC_LOG: string;
  CDP_LOG: string;
  logStream: fs.WriteStream;
  fd: number;

  constructor(debug: boolean, logDir: string = g.LOG_DIR) {
    this.browser = null;
    this.debug = debug;

    this.handleAttachedTarget = this.handleAttachedTarget.bind(this);
    this.writeToLog = this.writeToLog.bind(this);

    this.CRAWLER_LOG_DIR = logDir;
    if (!fs.existsSync(this.CRAWLER_LOG_DIR)) {
      fs.mkdirSync(this.CRAWLER_LOG_DIR, { recursive: true });
    }
    this.FORENSIC_LOG = path.join(this.CRAWLER_LOG_DIR, 'forensics.log');
    this.logStream = fs.createWriteStream(this.FORENSIC_LOG);

    this.CDP_LOG = path.join(this.CRAWLER_LOG_DIR, 'cdp.log');
    this.fd = fs.openSync(this.CDP_LOG, 'w');

    child_process.execSync(`rm -rf ${this.CRAWLER_LOG_DIR}/*`);
    if (this.logStream) {
      this.logStream.end();
    }
  }

  archive(url: string, adNetwork: string): void {
    const archiveDir = path.join(g.ARCHIVES_DIR, adNetwork);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    if (fs.existsSync(this.FORENSIC_LOG) && fs.existsSync(this.CDP_LOG)) {
      const tarBallName = url2str(url) + '.' + new Date().getTime() + '.tar.gz';
      const cmd = `tar -C ${this.CRAWLER_LOG_DIR} -czf ${path.join(
        archiveDir,
        tarBallName
      )} .`;
      logger.info(`Compressing ${tarBallName}. Command: ${cmd}`);
      child_process.execSync(cmd);
    } else {
      logger.error('Log file is not stored!!!');
    }
  }

  async handleAttachedTarget(target: Target): void {
    const cdp = await target.createCDPSession();
    if (target.type() === 'page') {
      await cdp.send('SE.enable');
      const hooks = [
        'DidInsertDOMNode',
        'CharacterDataModified',
        'DidAddEventListener',
        'DidRemoveEventListener',
        'DidAddUserCallback',
        'DidRemoveUserCallback',
        'DidCallFunction',
        'DidExecuteScript',
        'DidInsertDOMNode',
        'DidInvalidateStyleAttr',
        'DidModifyDOMAttr',
        'DidUpdateComputedStyle',
        'DidUserCallback',
        'DidCompileScript',
        'FrameAttachedToParent',
        'FrameRequestedNavigation',
        'WillCallFunction',
        'WillCommitLoad',
        'WillExecuteScript',
        'WillRemoveDOMNode',
        'WillSendRequest',
        'WillUserCallback',
        'WindowOpen',
        'DidRemoveDOMAttr',
      ];
      for (const hook of hooks) {
        cdp.on('SE.' + hook, this.writeToLog);
      }
    }
    await cdp.send('Runtime.runIfWaitingForDebugger');
  }

  async launchChromium(option: BrowserLaunchArgumentOptions): Promise<boolean> {
    this.browser = await puppeteer.launch(option);
    this.browser.on('targetcreated', this.handleAttachedTarget);
    const browserProcess = this.browser.process();
    if (!browserProcess) {
      logger.error('Browser process is null!!!!');
      return false;
    }
    browserProcess?.stderr?.pipe(this.logStream);
    browserProcess.on('exit', (code) => {
      logger.info(`Browser process exit with code ${code}`);
      // this.logStream.end();
    });
    return true;
  }

  async close(): Promise<void> {
    fs.closeSync(this.fd);
    await this.browser?.close();
    if (this.browser) {
      this.browser = null;
    }
  }

  writeToLog(param: SELog): void {
    fs.writeSync(this.fd, param.log);
  }

  async crawl(
    domain: string,
    device: string,
    numberToClick: number
  ): Promise<boolean> {
    if (!this.browser) {
      return false;
    }
    const page = await this.browser.newPage();
    const url = domain.startsWith('http') ? domain : 'http://' + domain;

    await page.emulate(puppeteer.devices[device || 'win10'] as Device);

    const crawler = new Crawler(
      page,
      this.CRAWLER_LOG_DIR,
      this.debug,
      numberToClick
    );
    await crawler.visit(url);
    // await this.close();
    return true;
  }
}
