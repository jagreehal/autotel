function greet(name: string): string;
function greet(name: string, formal: boolean): string;
function greet(name: string, formal?: boolean): string {
  if (formal) {
    return `Hello, ${name}`;
  }
  return `Hi, ${name}`;
}
