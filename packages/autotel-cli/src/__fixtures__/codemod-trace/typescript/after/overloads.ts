import { trace } from "autotel";

function greet(name: string): string;
function greet(name: string, formal: boolean): string;
const greet = trace('greet', function greet(name: string, formal?: boolean): string {
  if (formal) {
    return `Hello, ${name}`;
  }
  return `Hi, ${name}`;
};
