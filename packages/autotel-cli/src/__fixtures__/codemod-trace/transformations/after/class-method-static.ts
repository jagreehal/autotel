import { trace } from "autotel";

class UserService {
  static createUser(data: string) {
    return trace('UserService.createUser', () => {
  return data;
  })();
  }
}
