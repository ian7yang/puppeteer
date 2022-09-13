import * as fs from 'fs';
import * as path from 'path';

import * as _ from 'lodash';

import { CDPSession, Page } from '../api-docs-entry.js';

import { sleep, url2str, isMouseEvent } from './utils.js';
import { getConsoleLogger } from './logger.js';

const ignoredTags = new Set(['#text', 'STRONG', 'UL', 'LI']);

const logger = getConsoleLogger('crawler');

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Snapshot {
  domNodes: Node[];
  layoutTreeNodes: any[];
}

interface Node {
  nodeName: string;
  backendNodeId: number;
  eventListeners?: EventListener[];
}

interface DOMNode {
  boundingBox: BoundingBox;
  node: Node;
}

interface EventListener {
  type: string;
}

interface NodeCenter {
  x: number;
  y: number;
}

export default class Crawler {
  page: Page;
  logDir: string;
  debug: boolean;
  numberToClick: number;
  cdp: CDPSession | undefined;
  scale: number;
  clickedNodes: Set<string>;
  anchorNodes: DOMNode[];
  clickNodes: DOMNode[];
  seed: URL;
  url: string;
  constructor(
    page: Page,
    logDir: string,
    debug: boolean,
    numberToClick: number
  ) {
    this.anchorNodes = [];
    this.clickNodes = [];
    this.page = page;
    this.logDir = logDir;
    this.debug = debug;
    this.numberToClick = numberToClick || 10;
    this.cdp = undefined;
    this.scale = this.debug ? 1 : 1;
    this.clickedNodes = new Set();
    this.url = 'about:blank';
    this.seed = new URL(this.url);
  }

  setSeed(url: string): void {
    this.seed = new URL(url);
  }

  _serializeNode(box: BoundingBox): string {
    return `x:${box.x}, y:${box.y}, width:${box.width}, height:${box.height}`;
  }

  _isSameOrigin(url: string): boolean {
    const u = new URL(url);
    return this.seed.origin === u.origin;
  }

  _isSamePage(url: string): boolean {
    try {
      const u = new URL(url);
      return (
        this.seed.origin === u.origin &&
        !(u.pathname === this.seed.pathname && u.hash)
      );
    } catch (e) {
      return false;
    }
  }

  async _getDOMSnapshot(): Promise<Snapshot> {
    logger.info('Get DOMSnapshot');
    return (await this.cdp?.send('DOMSnapshot.getSnapshot', {
      computedStyleWhitelist: [],
      includeEventListeners: true,
    })) as Snapshot;
  }

  _isValidNode(item: DOMNode): boolean {
    if (!item.boundingBox) {
      return false;
    }
    return !(item.boundingBox.x < 0 || item.boundingBox.y < 0);
  }

  _getClickables(snapshot: Snapshot): {
    anchorNodes: DOMNode[];
    clickNodes: DOMNode[];
  } {
    logger.info('Extract clickable nodes');
    const { domNodes, layoutTreeNodes } = snapshot;
    const layoutMap = new Map<number, BoundingBox>();
    for (const { domNodeIndex, boundingBox } of layoutTreeNodes) {
      layoutMap.set(domNodeIndex, boundingBox);
    }
    const validNodes = domNodes
      .map((node: Node, idx: number) => {
        return {
          node,
          boundingBox: layoutMap.get(idx) || {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
        };
      })
      .filter(this._isValidNode);
    const anchorNodes = validNodes.filter((item: DOMNode) => {
      return item.node.nodeName === 'A';
    });
    const nodesHaveClickListeners = validNodes.filter((item: DOMNode) => {
      return (
        item.node.eventListeners &&
        !ignoredTags.has(item.node.nodeName) &&
        item.node.eventListeners.some((l) => {
          return isMouseEvent(l.type);
        })
      );
    });
    return {
      anchorNodes: _.shuffle(anchorNodes),
      clickNodes: _.reverse(
        _.sortBy(nodesHaveClickListeners, (o: DOMNode) => {
          return o.boundingBox.width * o.boundingBox.height;
        })
      ),
    };
  }

  async scrollBy(y: number, x = 0): Promise<void> {
    await this.page.evaluate(`window.scrollBy(${x}, ${y})`);
    await sleep(500);
  }

  async scrollTo(y: number, x = 0): Promise<void> {
    await this.page.evaluate(`window.scrollTo(${x}, ${y})`);
  }

  async scroll(scrollTimes = 10, scrollDistance = 500): Promise<void> {
    for (let i = 0; i < scrollTimes; i++) {
      await this.scrollBy(scrollDistance);
      await sleep(500);
    }
    await this.scrollTo(0);
  }

  async getNodeCenter({ node, boundingBox }: DOMNode): Promise<NodeCenter> {
    let quads;
    let contentQuads;
    try {
      contentQuads = await this.cdp?.send('DOM.getContentQuads', {
        backendNodeId: node.backendNodeId,
      });
    } catch (e: any) {
      logger.warn(`Unable to get quads for ${node.nodeName} (${e.message})`);
    }
    if (contentQuads) {
      quads = contentQuads.quads;
    }
    const ret = {} as NodeCenter;
    ret.x = boundingBox.x + boundingBox.width / 2;
    ret.y = boundingBox.y + boundingBox.height / 2;
    if (quads) {
      if (quads.length) {
        // we only use the first one
        const point = quads[0] as any;
        if (point.length === 8) {
          // left top, right top, right bottom, left bottom
          ret.y = (point[5] - point[1]) / 2 + point[1];
        }
      }
    } else {
      const res = await this.cdp?.send('Page.getLayoutMetrics');

      if (res?.cssVisualViewport) {
        logger.debug('Fall back to use cssVisualViewport');
        const { pageY } = res.cssVisualViewport;
        ret.y = boundingBox.y - pageY + boundingBox.height / 2;
      }
    }
    return ret;
  }

  async click(domNode: DOMNode): Promise<NodeCenter> {
    const { x, y } = await this.getNodeCenter(domNode);
    logger.debug(`Clicking node ${domNode.node.nodeName} at (${x}, ${y})`);
    this.clickedNodes.add(this._serializeNode(domNode.boundingBox));
    await this.page.mouse.click(x / this.scale, y, { delay: 500 });
    return { x, y };
  }

  async addClickEffect(): Promise<void> {
    if (this.debug) {
      await this.page.evaluate(
        fs.readFileSync(path.resolve(__dirname, 'effects.js'), {
          encoding: 'utf-8',
        })
      );
    }
  }

  async updateNodesToClick(): Promise<void> {
    const { anchorNodes, clickNodes } = this._getClickables(
      await this._getDOMSnapshot()
    );
    this.anchorNodes = anchorNodes;
    this.clickNodes = clickNodes;
  }

  async visit(url: string): Promise<void> {
    this.setSeed(url);
    this.cdp = await this.page.target().createCDPSession();
    let done = false;
    while (!done) {
      logger.info(`Visit ${url}`);
      try {
        await this.page.goto(url);
        logger.info(`Loaded ${url}`);
      } catch (e: any) {
        logger.error(`Failed to visit page: ${url}. ${e.message}`);
        break;
      }
      this.url = this.page.url();
      await this.scroll();
      await sleep(2000); // may be longer, 60 seconds
      await this.run();
      logger.info(`Visiting ${url} is done`);
      done = true;
    }
  }

  async takeScreenshots(): Promise<void> {
    const pages = await this.page.browser().pages();
    for (const p of pages) {
      if (p !== this.page) {
        if (
          !p.url().startsWith('chrome') &&
          !p.url().startsWith('about:blank') &&
          !p.mainFrame().parentFrame()
        ) {
          await this._takeScreenshot(p, 'openWindow');
        }
      }
    }
  }

  async _takeScreenshot(page: Page, source: string): Promise<void> {
    // we  take a screen shot and name it with the page's url.
    logger.info(`Taking screenshot for ${page.url()}`);
    await page.screenshot({
      path: `${path.resolve(
        this.logDir,
        page.target()._targetId + '___' + url2str(page.url())
      )}___${source}.png`,
    });
  }

  async clickNode(nodeList: DOMNode[], count: number): Promise<void> {
    let node = nodeList.pop();
    let clicks = 0;
    while (nodeList.length > 0 && node && clicks < count) {
      await this.page.bringToFront();
      if (this.page.url() !== this.url) {
        // this takes care of same-tab navigation
        // we only take screenshots for cross-origin navigation
        try {
          if (
            !this._isSameOrigin(this.page.url()) &&
            this.page.url().startsWith('http')
          ) {
            await sleep(5000);
            await this._takeScreenshot(this.page, 'navigation');
          }

          await this.page.goBack();
          await sleep(2000);
          await this.addClickEffect();
          await this.updateNodesToClick();
        } catch (e: any) {
          logger.error(`Failed to go back to page: ${this.url}. ${e.message}`);
          break;
        }
      } else {
        if (!this.clickedNodes.has(this._serializeNode(node.boundingBox))) {
          try {
            await this.click(node);
            clicks++;
          } catch (e: any) {
            logger.error(
              `Failed to click. ${e.message}. ${this.debug ? e.stack : ''}`
            );
          }
          await sleep(500);
        }
        node = nodeList.pop();
      }
    }
  }

  async run(): Promise<void> {
    logger.info('Start interacting with the page');
    await this.addClickEffect();
    await this.updateNodesToClick();
    // let's click clickable node first
    // await this.clickNode(this.clickNodes, this.numberToClick);
    // now click anchor links
    // await this.clickNode(this.anchorNodes, this.numberToClick)

    await this.takeScreenshots();
  }
}
