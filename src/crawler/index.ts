import Manager from "./manager";
import {sleep} from './utils'

const Xvfb = require('xvfb');
const argv = require('yargs-parser')(process.argv.slice(2))

const {getConsoleLogger} = require('./logger');

const logger = getConsoleLogger('main');

const setupXvfb = (interactive: boolean) => {

  if (interactive) return () => { }
  logger.info('Starting Xvfb')
  const xvfbHandler = new Xvfb({
    xvfb_args: ['-screen', '0', '1920x1080x24']
  })
  xvfbHandler.startSync()

  return () => {
    logger.info('Stropping Xvfb')
    xvfbHandler.stopSync()
  }
}

async function run() {
  const { interactive, debug, numberToClick, device, website, timeout, chrome } = argv;
  const launchOptions = {
    headless: !interactive,
    args: ['--no-sandbox', '--enable-logging=stderr', '--vmodule=forensic_recorder=7'],
    executablePath: chrome,
    // dumpio: true
  };
  const stopXvfb = setupXvfb(interactive);
  const manager = new Manager(debug);
  await manager.launchChromium(launchOptions);

  let url = website;
  logger.info(`Start crawling ${url}`);
  try {
    await Promise.race([manager.crawl(url, device, numberToClick), sleep(timeout * 60 * 1000)])
    logger.info(`${url} completed.`)
  } catch (e) {
    // @ts-ignore
    logger.error('Crawler error: ' + e.message + '. Stack: ' + e.stack);
  }
  stopXvfb();
}

run().catch(e => {
  logger.error('Run error: ' + e.message + '. Stack: ' + e.stack);
})
