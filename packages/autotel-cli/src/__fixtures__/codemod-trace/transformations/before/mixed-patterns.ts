function createUser(data: string) {
  return data;
}

const updateUser = (id: string, data: string) => {
  return { id, data };
};

const deleteUser = function (id: string) {
  return id;
};

class UserService {
  getUser(id: string) {
    return id;
  }
}

const helpers = {
  formatUser(user: string) {
    return user.toUpperCase();
  }
};
