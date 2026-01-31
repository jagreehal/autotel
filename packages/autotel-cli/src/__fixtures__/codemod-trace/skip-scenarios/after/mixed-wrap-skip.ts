import { trace } from "autotel";

const createUser = trace('createUser', function createUser(data: string) {
  return data;
};

class UserService {
  constructor(name: string) {
    console.log(name);
  }

  *generateIds() {
    yield 1;
  }

  getUser(id: string) {
    return trace('UserService.getUser', () => {
  return id;
  })();
  }
}
