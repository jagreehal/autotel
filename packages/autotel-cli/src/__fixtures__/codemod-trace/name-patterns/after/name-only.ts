import { trace } from "autotel";

const createUser = trace('createUser', function createUser(data: string) {
  return data;
};

const updateUser = trace('updateUser', function updateUser(id: string, data: string) {
  return { id, data };
};
