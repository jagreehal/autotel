import { trace } from "autotel";

class UserService {
  createUser(data) {
    return trace('UserService.createUser', () => {
  return data;
  })();
  }
}
