import { HttpsProxyAgent } from "https-proxy-agent";
import WebSocket from "ws";
import type {
  DiscordWebSocketLike,
} from "@lencx/minke-im-discord";
import type {
  DiscordNetworkWebSocketPort,
} from "./discord-network.ts";

/**
 * Create Discord Gateway sockets through the exact proxy selected for REST.
 */
export function createDiscordNetworkWebSocketPort():
  DiscordNetworkWebSocketPort {
  return Object.freeze({
    create(
      url: string,
      httpProxyUrl: string,
    ): DiscordWebSocketLike {
      const socket =
        httpProxyUrl === ""
          ? new WebSocket(url)
          : new WebSocket(url, {
              agent: new HttpsProxyAgent(httpProxyUrl),
            });
      return socket as unknown as DiscordWebSocketLike;
    },
  });
}
