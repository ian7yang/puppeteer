import Manager from './manager.js';
import { sleep } from './utils.js';
import yargsParser from 'yargs-parser';
import Xvfb from './xvfb.js';

const argv = yargsParser(process.argv.slice(2));

import { getConsoleLogger } from './logger.js';

const logger = getConsoleLogger('main');

const setupXvfb = async (interactive: boolean): Promise<() => void> => {
  if (interactive) {
    return async () => {};
  }
  logger.info('Starting Xvfb');
  const xvfbHandler = new Xvfb({
    args: ['-screen', '0', '1920x1080x24'],
  });
  await xvfbHandler.start();

  return async () => {
    logger.info('Stropping Xvfb');
    await xvfbHandler.stop();
  };
};

async function run() {
  const {
    interactive,
    debug,
    numberToClick,
    device,
    website,
    timeout,
    chrome,
  } = argv;
  const launchOptions = {
    headless: !interactive,
    args: [
      '--no-sandbox',
      '--enable-logging=stderr',
      '--vmodule=forensic_recorder=7',
    ],
    executablePath: chrome,
    // dumpio: true
  };
  const stopXvfb = await setupXvfb(interactive);
  const manager = new Manager(debug);
  await manager.launchChromium(launchOptions);

  const url = website;
  logger.info(`Start crawling ${url}`);
  try {
    await Promise.race([
      manager.crawl(url, device, numberToClick),
      sleep(timeout * 60 * 1000),
    ]);
    logger.info(`${url} completed.`);
  } catch (e: any) {
    logger.error('Crawler error: ' + e.message + '. Stack: ' + e.stack);
  }
  stopXvfb();
}

run().catch((e) => {
  logger.error('Run error: ' + e.message + '. Stack: ' + e.stack);
});
