import { trace } from "autotel";

const createUser = trace('createUser', function createUser(data: string) {
  return data;
};

const updateUser = trace('updateUser', (id: string, data: string) => {
  return { id, data };
});

const deleteUser = trace('deleteUser', function (id: string) {
  return id;
});

class UserService {
  getUser(id: string) {
    return trace('UserService.getUser', () => {
  return id;
  })();
  }
}

const helpers = {
  formatUser(user: string) {
      return trace('formatUser', () => {
    return user.toUpperCase();
    })();
    }
};
