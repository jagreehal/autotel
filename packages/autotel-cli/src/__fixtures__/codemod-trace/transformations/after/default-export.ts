import { trace } from "autotel";

const createUser = trace('createUser', function createUser(data: string) {
  return data;
};
export default createUser;
