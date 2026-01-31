import { trace } from "autotel";

const createUser = trace('src/users/basic.ts:createUser', function createUser(data: string) {
  return data;
};

const updateUser = trace('src/users/basic.ts:updateUser', function updateUser(id: string, data: string) {
  return { id, data };
};
