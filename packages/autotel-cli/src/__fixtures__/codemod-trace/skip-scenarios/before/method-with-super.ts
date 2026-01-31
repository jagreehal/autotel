class BaseService {
  process() {
    return 'base';
  }
}

class UserService extends BaseService {
  process() {
    return super.process() + ' user';
  }
}
