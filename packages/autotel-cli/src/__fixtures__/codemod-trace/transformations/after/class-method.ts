import { trace } from "autotel";

class UserService {
  createUser(data: string) {
    return trace('UserService.createUser', () => {
  return data;
  })();
  }
}
