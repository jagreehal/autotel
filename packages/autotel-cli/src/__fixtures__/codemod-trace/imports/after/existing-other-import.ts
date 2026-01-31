import { trace } from "autotel";
import { init } from 'autotel';

const createUser = trace('createUser', function createUser(data: string) {
  return data;
};
