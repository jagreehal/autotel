class IdService {
  *generateIds() {
    let id = 0;
    while (true) {
      yield id++;
    }
  }
}
