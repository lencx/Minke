# Minke Remote Access

`@lencx/minke-remote-access` owns Minke's optional remote-access lifecycle. It is independent of Electron, defaults off, and exposes one provider-neutral service over three transports:

- **Tailscale Serve** resolves the connected node's `*.ts.net` name, adds only that name to the Harness trusted-host fence, and owns one foreground `tailscale serve --yes --bg=false` process targeting the random loopback Harness origin.
- **Tailscale direct** binds a raw TCP forwarder to the node's exact `100.64.0.0/10` IPv4 address and an OS-assigned port. It never binds a LAN or wildcard address, and the Harness continues to listen only on loopback.
- **Cloudflare Access** owns one foreground, locally configured named tunnel. A loopback-only origin gateway validates the Access JWT issuer and audience with rotating JWKS before forwarding HTTP or WebSocket traffic, then removes the Access JWT and authorization cookie before the Harness sees the request. The spawned command pins `--url` to this gateway, so a supplied configuration cannot select another local origin; configurations with ingress rules fail closed because cloudflared does not allow them together with `--url`.

Cloudflare hostnames use a compact random `m-<16 character>` label by default, encoding 80 bits without user or machine metadata. A readable custom hostname is an explicit opt-in. The label is an identifier, not an authentication secret.

Command discovery checks known installation paths and `PATH` without executing either CLI. `RemoteAccessRuntime` reconciles persisted settings against an already-running loopback Harness: it discovers the selected provider in the background, gives each Tailscale status probe up to 30 seconds, and retries transient status failures with bounded backoff without delaying the local window. Before exposing a transport it sends the exact authority over the private desktop-to-Harness control channel and waits for an acknowledgement; teardown closes the transport before revoking that authority. Settings changes cancel stale work and reconcile immediately, so enabling or disabling remote access does not restart Minke. `stop()` owns all process, listener, socket, retry, and trust-policy cleanup.

DSH browser authentication binds its signed cookie to the request authority. The desktop therefore keeps the provider target and displayed status URL clean, while the renderer receives a process-scoped `/?token=…` bootstrap URL for copying or opening the active remote authority. The launch token is validated before reconciliation, never passed to a provider, never persisted, and removed from renderer snapshots as soon as the Harness detaches or exits.

The module never enables Tailscale Funnel, never creates a persistent Serve rule, and does not use Cloudflare Quick Tunnels or token-based environment overrides. Targets must be exact random-port `127.0.0.1` Harness origins.
