import { trace } from 'autotel';

const createUser = trace('createUser', async (data: string) => {
  return data;
});
