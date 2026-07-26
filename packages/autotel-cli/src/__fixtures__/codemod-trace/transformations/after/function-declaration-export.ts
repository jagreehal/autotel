import { trace } from "autotel";

export const createUser = trace('createUser', function createUser(data: string) {
  return data;
});
