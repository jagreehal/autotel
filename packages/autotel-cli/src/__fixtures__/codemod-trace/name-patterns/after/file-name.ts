import { trace } from "autotel";

const createUser = trace('basic.createUser', function createUser(data: string) {
  return data;
};

const updateUser = trace('basic.updateUser', function updateUser(id: string, data: string) {
  return { id, data };
};
