---
'autotel-devtools': minor
---

### autotel-devtools — detect foreign OTLP collectors on port conflict, plus a first-class identity signal

- **Foreign-collector detection:** when the requested port is busy and the receiver falls forward to another port, it now probes who holds the original port. If it is another autotel-devtools instance, the warning says so (benign). If it is a *foreign* process (for example an IDE's built-in OTLP collector), it warns explicitly that apps exporting OTLP to the busy port are reaching that process — not this devtools — and to point the exporter at the bound port or free the original. This removes a silent footgun where the UI sat empty while apps saw export errors.
- **Identity signal:** every HTTP response now carries an `x-autotel-devtools: <version>` header (exposed via CORS), and `GET /healthz` returns `{ ok, service: "autotel-devtools", version, clients }`. Clients and integrators can positively confirm they are talking to autotel-devtools instead of guessing from the body shape.
- **Clearer ingest errors:** a failed OTLP POST now echoes the `contentType` it received alongside the message, so a misconfigured exporter (wrong or missing content type) is diagnosable from the 400 response.
- **New exports:** `probePortHolder()`, `DEVTOOLS_IDENTITY`, and the `PortHolder` type are exported from `autotel-devtools/server`.
