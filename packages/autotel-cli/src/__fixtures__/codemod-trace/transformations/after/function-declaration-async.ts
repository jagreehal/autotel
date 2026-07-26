import { trace } from "autotel";

const fetchUser = trace('fetchUser', async function fetchUser(id: string) {
  return await fetch(`/api/users/${id}`);
});
