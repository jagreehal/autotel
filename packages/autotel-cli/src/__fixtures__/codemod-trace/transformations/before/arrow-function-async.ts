const fetchUser = async (id: string) => {
  return await fetch(`/api/users/${id}`);
};
