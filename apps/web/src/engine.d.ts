declare module "virtual:engine" {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  export type Engine = any;   // packages/engine/engine.js: ~160 functions plus S, its state. Typed loosely on purpose, as on the server.
  export function createEngine(): Engine;
}
