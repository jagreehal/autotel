async function fetchUser(id: string) {
  return await fetch(`/api/users/${id}`);
}
