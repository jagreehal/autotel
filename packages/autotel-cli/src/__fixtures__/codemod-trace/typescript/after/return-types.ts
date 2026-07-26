import { trace } from "autotel";

interface User {
  id: string;
  name: string;
}

const getUser = trace('getUser', async function getUser(id: string): Promise<User> {
  return { id, name: 'Test' };
});

const getUserSync = trace('getUserSync', function getUserSync(id: string): User | null {
  return { id, name: 'Test' };
});
