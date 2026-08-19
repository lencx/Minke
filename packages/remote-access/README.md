# Minke Remote Access

`@lencx/minke-remote-access` owns optional remote-access lifecycles for Minke.
The package is independent of Electron and currently implements one method:
Tailscale Serve.

Remote access is opt-in and defaults off. When enabled, the Tailscale method:

1. resolves the installed Tailscale CLI without executing it during discovery;
2. reads the connected node's `*.ts.net` name from `tailscale status --json`;
3. gives that exact hostname to DSH's trusted-host fence while DSH continues to
   listen only on `127.0.0.1` and an OS-assigned port;
4. starts `tailscale serve --yes` in foreground mode against that exact
   loopback URL; and
5. stops the foreground process before Minke shuts down.

Foreground Serve configuration is tied to the CLI session, so Minke never
creates a persistent background Serve rule and never uses Tailscale Funnel.
The target validator rejects LAN addresses, hostnames, paths, credentials,
queries, and fragments.

The package intentionally has no provider-adapter interface yet. A second
remote method can establish the real shared seam instead of making Tailscale
conform to a speculative abstraction.
