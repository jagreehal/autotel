import { trace } from "autotel";

class BaseService {
  process() {
    return trace('BaseService.process', () => {
  return 'base';
  })();
  }
}

class UserService extends BaseService {
  process() {
    return super.process() + ' user';
  }
}
