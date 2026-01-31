function identity<T>(arg: T): T {
  return arg;
}

const mapArray = <T, U>(arr: T[], fn: (item: T) => U): U[] => {
  return arr.map(fn);
};
