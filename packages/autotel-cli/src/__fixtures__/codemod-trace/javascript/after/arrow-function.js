import { trace } from "autotel";

const createUser = trace('createUser', (data) => {
  return data;
});
