import { trace } from "autotel";

const userService = {
  createUser(data: string) {
      return trace('createUser', () => {
    return data;
    })();
    }
};
