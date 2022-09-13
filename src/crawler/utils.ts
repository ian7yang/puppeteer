import * as path from 'path';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    return setTimeout(resolve, ms);
  });
}

export function url2str(url: string, full = false): string {
  const obj = new URL(url);
  const host = obj.hostname.replace(/\./g, '_');
  if (!full) {
    return host;
  }
  return host + obj.pathname.replace(/\//g, '__');
}

export const devices = {
  win10: {
    viewport: {
      width: 1920,
      height: 1080,
    },
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36.`,
  },
  macos: {
    viewport: {
      width: 1920,
      height: 1080,
    },
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36`,
  },
  linux: {
    viewport: {
      width: 1920,
      height: 1080,
    },
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36`,
  },
  iphone: {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Mobile/15E148 Safari/604.1',
    viewport: {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  },
  ipad: {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
    viewport: {
      width: 1024,
      height: 1366,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  },
};

const BASE_DIR = path.dirname(path.dirname(path.resolve(__dirname)));

const LOG_DIR = path.join(BASE_DIR, 'logs');

const ARCHIVES_DIR = path.join(BASE_DIR, 'archives');

export const g = {
  BASE_DIR,
  LOG_DIR,
  ARCHIVES_DIR,
};

const mouseEvents = new Set(['contextmenu']);

export function isMouseEvent(event: string): boolean {
  if (!event) {
    return false;
  }
  if (
    event.startsWith('mouse') ||
    event.startsWith('pointer') ||
    event.startsWith('touch')
  ) {
    return true;
  }
  if (event.endsWith('click')) {
    return true;
  }
  return mouseEvents.has(event);
}
