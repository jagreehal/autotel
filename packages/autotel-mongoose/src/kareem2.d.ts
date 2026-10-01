// `kareem2` is a package.json npm-alias for kareem@^2.6.3 (the callback-based
// hook engine used by Mongoose < 8). Its bundled types declare `module "kareem"`,
// so importing from the alias specifier resolves a file with no matching module
// declaration ("not a module"). It can't borrow the installed `kareem` (v3)
// types either: v3's execPre returns a promise instead of taking a callback.
// Declare the v2 surface the tests use, as kareem2's own index.d.ts has it.
declare module 'kareem2' {
  export default class Kareem {
    pre(name: string | RegExp, fn: Function): this;
    execPre(name: string, context: any, args: any[], callback?: Function): void;
  }
}
