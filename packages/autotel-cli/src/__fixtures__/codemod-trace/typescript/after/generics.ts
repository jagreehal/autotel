import { trace } from "autotel";

const identity = trace('identity', function identity<T>(arg: T): T {
  return arg;
};

const mapArray = trace('mapArray', <T, U>(arr: T[], fn: (item: T) => U): U[] => {
  return arr.map(fn);
});
