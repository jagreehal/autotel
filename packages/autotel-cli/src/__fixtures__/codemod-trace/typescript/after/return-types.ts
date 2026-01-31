import { trace } from "autotel";

interface User {
  id: string;
  name: string;
}

async const getUser = trace('getUser', function getUserasync function getUser(id: string): Promise<User> {
  return { id, name: 'Test' };
};

const getUserSync = trace('getUserSync', function getUserSync(id: string): User | null {
  return { id, name: 'Test' };
};
