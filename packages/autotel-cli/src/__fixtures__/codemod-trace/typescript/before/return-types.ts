interface User {
  id: string;
  name: string;
}

async function getUser(id: string): Promise<User> {
  return { id, name: 'Test' };
}

function getUserSync(id: string): User | null {
  return { id, name: 'Test' };
}
