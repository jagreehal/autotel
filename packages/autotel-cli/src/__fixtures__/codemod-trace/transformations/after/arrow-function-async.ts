import { trace } from "autotel";

const fetchUser = trace('fetchUser', async (id: string) => {
  return await fetch(`/api/users/${id}`);
});
