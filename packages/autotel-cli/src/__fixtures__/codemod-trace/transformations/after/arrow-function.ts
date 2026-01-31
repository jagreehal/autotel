import { trace } from "autotel";

const createUser = trace('createUser', (data: string) => {
  return data;
});
