/**
 * Two node globals, declared rather than installed: the UI-invariant guard reads
 * styles.css off disk (a stylesheet cannot be imported as a module under vitest),
 * and pulling @types/node into a browser project for that is worse than five lines
 * of declaration. Types only - nothing here changes what ships.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}

declare const process: { cwd(): string };
