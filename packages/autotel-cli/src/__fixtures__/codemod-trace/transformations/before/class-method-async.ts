class UserService {
  async fetchUser(id: string) {
    return await fetch(`/api/users/${id}`);
  }
}
