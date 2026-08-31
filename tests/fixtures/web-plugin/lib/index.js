export const inject = ["pluginInventory", "webServer"];

export function apply(ctx) {
  return ctx.webServer.register({
    kind: "exact",
    path: "/smoke/plugin-inventory",
    async handler(request, response) {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      const inventory = await ctx.pluginInventory.list();
      response.end(JSON.stringify(inventory));
    },
  });
}
