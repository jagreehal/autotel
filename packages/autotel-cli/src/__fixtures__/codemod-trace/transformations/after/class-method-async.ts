import { trace } from "autotel";

class UserService {
  async fetchUser(id: string) {
    return trace('UserService.fetchUser', async () => {
  return await fetch(`/api/users/${id}`);
  })();
  }
}
