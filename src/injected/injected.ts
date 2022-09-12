import {createDeferredPromise} from '../util/DeferredPromise.js';
import * as Poller from './Poller.js';
import * as util from './util.js';

/**
 * @internal
 */
export const injectedUtil = Object.freeze({
  ...Poller,
  ...util,
  createDeferredPromise,
});

Object.assign(self, {InjectedUtil: injectedUtil});
