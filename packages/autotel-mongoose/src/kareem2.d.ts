// `kareem2` is a package.json npm-alias for kareem@^2.6.3 (the callback-based
// hook engine used by Mongoose < 8). Its bundled types declare `module "kareem"`,
// so importing from the alias specifier resolves a file with no matching module
// declaration ("not a module"). Re-point the alias at the identical Kareem type.
declare module 'kareem2' {
  import Kareem from 'kareem';
  export default Kareem;
}
