import util from 'node:util';

interface Deps {
  log: { debug(message: string): void };
}

export const dump = (deps: Deps, response: unknown): void => {
  deps.log.debug(util.inspect(response));
};
