import {Poller} from '../injected/Poller.js';
import {createDeferredPromise} from '../util/DeferredPromise.js';
import {ElementHandle} from './ElementHandle.js';
import {TimeoutError} from './Errors.js';
import {IsolatedWorld} from './IsolatedWorld.js';
import {JSHandle} from './JSHandle.js';
import {HandleFor} from './types.js';

/**
 * @internal
 */
export interface WaitTaskOptions {
  bindings?: Map<string, (...args: never[]) => unknown>;
  polling: 'raf' | 'mutation' | number;
  root?: ElementHandle<Node>;
  timeout: number;
}

/**
 * @internal
 */
export class WaitTask<T = unknown> {
  #world: IsolatedWorld;
  #bindings: Map<string, (...args: never[]) => unknown>;
  #polling: 'raf' | 'mutation' | number;
  #root?: ElementHandle<Node>;

  #fn: (...args: unknown[]) => Promise<T>;
  #args: unknown[];

  #timeout?: NodeJS.Timeout;

  #result = createDeferredPromise<HandleFor<T>>();

  #poller?: JSHandle<Poller<T>>;

  constructor(
    world: IsolatedWorld,
    options: WaitTaskOptions,
    fn: (...args: unknown[]) => Promise<T>,
    ...args: unknown[]
  ) {
    this.#world = world;
    this.#bindings = options.bindings ?? new Map();
    this.#polling = options.polling;
    this.#root = options.root;

    this.#fn = fn;
    this.#args = args;

    this.#world.taskManager.add(this);

    if (options.timeout) {
      this.#timeout = setTimeout(() => {
        this.terminate(
          new TimeoutError(`Waiting failed: ${options.timeout}ms exceeded`)
        );
      }, options.timeout);
    }

    if (this.#bindings.size !== 0) {
      for (const [name, fn] of this.#bindings) {
        this.#world._boundFunctions.set(name, fn);
      }
    }

    this.rerun();
  }

  get result(): Promise<HandleFor<T>> {
    return this.#result;
  }

  async rerun(): Promise<void> {
    const context = await this.#world.executionContext();

    if (this.#bindings.size !== 0) {
      for (const [name] of this.#bindings) {
        await this.#world._addBindingToContext(context, name);
      }
    }

    try {
      switch (this.#polling) {
        case 'raf':
          this.#poller = await context.evaluateHandle(
            (fn, ...args) => {
              return new InjectedUtil.RAFPoller(() => {
                return InjectedUtil.createFunction(fn)(...args) as Promise<T>;
              });
            },
            this.#fn.toString(),
            ...this.#args
          );
          break;
        case 'mutation':
          this.#poller = await context.evaluateHandle(
            (root, fn, ...args) => {
              return new InjectedUtil.MutationPoller(() => {
                return InjectedUtil.createFunction(fn)(...args) as Promise<T>;
              }, root || document);
            },
            this.#root,
            this.#fn.toString(),
            ...this.#args
          );
          break;
        default:
          this.#poller = await context.evaluateHandle(
            (ms, fn, ...args) => {
              return new InjectedUtil.IntervalPoller(() => {
                return InjectedUtil.createFunction(fn)(...args) as Promise<T>;
              }, ms);
            },
            this.#polling,
            this.#fn.toString(),
            ...this.#args
          );
          break;
      }

      const result = await this.#poller.evaluateHandle(poller => {
        return poller.start();
      });
      if (!this.#result.finished()) {
        this.#world.taskManager.delete(this);
        this.#result.resolve(result);
      }
      await this.terminate();
    } catch (error) {
      await this.handleError(error);
    }
  }

  async terminate(error?: unknown): Promise<void> {
    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }

    if (error && !this.#result.finished()) {
      this.#world.taskManager.delete(this);
      this.#result.reject(error);
    }

    if (this.#poller) {
      await this.#poller.evaluateHandle(async poller => {
        await poller.stop();
      });
      await this.#poller.dispose();
      this.#poller = undefined;
    }
  }

  async handleError(error: unknown): Promise<void> {
    if (error instanceof Error) {
      if (error.message.includes('TypeError: binding is not a function')) {
        return this.rerun();
      }
      // When frame is detached the task should have been terminated by the IsolatedWorld.
      // This can fail if we were adding this task while the frame was detached,
      // so we terminate here instead.
      if (
        error.message.includes(
          'Execution context is not available in detached frame'
        )
      ) {
        this.terminate(new Error('Waiting failed: Frame detached'));
        return;
      }

      // When the page is navigated, the promise is rejected.
      // We will try again in the new execution context.
      if (error.message.includes('Execution context was destroyed')) {
        return;
      }

      // We could have tried to evaluate in a context which was already
      // destroyed.
      if (error.message.includes('Cannot find context with specified id')) {
        return;
      }
    }

    this.terminate(error);
  }
}

/**
 * @internal
 */
export class TaskManager {
  #tasks: Set<WaitTask> = new Set<WaitTask>();

  add(task: WaitTask<any>): void {
    this.#tasks.add(task);
  }

  delete(task: WaitTask<any>): void {
    this.#tasks.delete(task);
  }

  terminateAll(error?: Error): void {
    for (const task of this.#tasks) {
      task.terminate(error);
    }
    this.#tasks.clear();
  }

  async rerunAll(): Promise<void> {
    await Promise.all(
      [...this.#tasks].map(task => {
        return task.rerun();
      })
    );
  }
}
