---
'autotel-playwright': patch
---

- Run test body and propagation.inject inside the test span context so trace context is active and W3C headers are correct.
- On test failure, mark the test span as error and record the exception before rethrowing.
- Add tests for error recording and context propagation.
