import { trace } from "autotel";

async const fetchUser = trace('fetchUser', function fetchUserasync function fetchUser(id: string) {
  return await fetch(`/api/users/${id}`);
};
