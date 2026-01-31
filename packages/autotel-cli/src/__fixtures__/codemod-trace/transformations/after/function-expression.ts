import { trace } from "autotel";

const createUser = trace('createUser', function (data: string) {
  return data;
});
