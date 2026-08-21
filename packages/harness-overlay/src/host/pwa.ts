import { readFile } from "node:fs/promises";
import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  MINKE_PWA_ROUTES,
} from "../pwa-contract.ts";

export { MINKE_PWA_ROUTES };

export const MINKE_PWA_MANIFEST = `${JSON.stringify(
  {
    id: "/",
    name: "Minke",
    short_name: "Minke",
    description: "A focused workspace for DeepSeek Harness.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e1324",
    theme_color: "#0e1324",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      {
        src: MINKE_PWA_ROUTES.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: MINKE_PWA_ROUTES.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: MINKE_PWA_ROUTES.maskableIcon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  null,
  2,
)}\n`;

const OFFLINE_ICON = [
  '<svg aria-hidden="true" viewBox="0 0 832 832">',
  '<rect width="832" height="832" rx="182.8125" fill="#0e1324"/>',
  '<path fill="#fdfdfd" d="m437.587907 430.95442c15.012837-181.35846 261.147481-260.086019 265.280306-219.57142 10.612789 106.033587-114.385179 248.339993-192.070113 303.515172l.018949-.010111c110.042287 93.901273 147.48881 177.076689 308.234255 201.952791l.024955-.006984c-26.891831 67.477663-92.821175 115.166132-169.888759 115.166132l-207.150884-.003613c-25.845619-105.919985-34.937273-202.960069-28.886832-265.849738.530231-5.511349 1.371363-10.786918 2.489501-15.801176-74.031621 5.595025-235.312747-32.653886-291.556232-126.150813-20.691818-34.591122 199.819647-128.261366 313.534918 6.793542z"/>',
  "</svg>",
].join("");

function offlinePage(
  language: "en" | "zh",
): string {
  const copy = language === "zh"
    ? {
        title: "无法连接到 Minke Host",
        description:
          "请确认桌面端 Minke 和远程访问仍在运行，然后重新连接。",
        action: "重新连接",
      }
    : {
        title: "Minke Host is offline",
        description:
          "Check that desktop Minke and remote access are running, then reconnect.",
        action: "Reconnect",
      };
  return [
    "<!doctype html>",
    `<html lang="${language === "zh" ? "zh-CN" : "en"}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="theme-color" content="#0e1324">',
    `<title>${copy.title}</title>`,
    "<style>",
    "html{color-scheme:dark;background:#0e1324}",
    "body{min-height:100dvh;margin:0;display:grid;place-items:center;box-sizing:border-box;padding:max(32px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:#0e1324;color:#f7f8fb;font:15px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;text-align:center}",
    "main{width:min(100%,420px)}",
    "svg{width:72px;height:72px;display:block;margin:0 auto 24px}",
    "h1{margin:0;font-size:24px;line-height:1.25;letter-spacing:-.02em}",
    "p{margin:12px auto 26px;max-width:38ch;color:#b8becc}",
    "a{display:inline-flex;min-height:42px;align-items:center;justify-content:center;padding:0 18px;border-radius:12px;background:#f7f8fb;color:#0e1324;font-weight:650;text-decoration:none}",
    "a:hover{background:#fff}",
    "a:focus-visible{outline:3px solid #8da2ff;outline-offset:4px}",
    "::selection{background:#8da2ff;color:#0e1324}",
    "</style>",
    "</head>",
    "<body><main>",
    OFFLINE_ICON,
    `<h1>${copy.title}</h1>`,
    `<p>${copy.description}</p>`,
    `<a href="/">${copy.action}</a>`,
    "</main></body></html>",
  ].join("");
}

function connectingPage(
  language: "en" | "zh",
): string {
  const copy = language === "zh"
    ? {
        title: "正在连接 Minke Host",
        description:
          "网络响应较慢。Minke 会持续重试，并在 Host 可用后自动进入。",
        action: "立即重试",
        retrying: "正在重试…",
        ready: "已连接，正在进入…",
      }
    : {
        title: "Connecting to Minke Host",
        description:
          "The network is responding slowly. Minke will keep trying and open automatically when the Host is ready.",
        action: "Retry now",
        retrying: "Retrying…",
        ready: "Connected. Opening Minke…",
      };
  const retryScript = [
    "(()=>{",
    'const status=document.querySelector("[data-minke-pwa-connecting-status]");',
    'const action=document.querySelector("[data-minke-pwa-connecting-action]");',
    "let retryTimer;",
    "let probing=false;",
    "const probe=async()=>{",
    "if(probing)return;",
    "probing=true;",
    `status.textContent=${JSON.stringify(copy.retrying)};`,
    "const controller=new AbortController();",
    "const timeout=setTimeout(()=>controller.abort(),5000);",
    "try{",
    "const response=await fetch(location.href,{",
    'cache:"no-store",',
    'credentials:"same-origin",',
    'headers:{"x-minke-pwa-probe":"1"},',
    "signal:controller.signal",
    "});",
    "if(response.ok){",
    `status.textContent=${JSON.stringify(copy.ready)};`,
    "location.reload();",
    "return;",
    "}",
    "}catch{}finally{",
    "clearTimeout(timeout);",
    "probing=false;",
    "}",
    "retryTimer=setTimeout(probe,1500);",
    "};",
    'action.addEventListener("click",()=>{',
    "clearTimeout(retryTimer);",
    "void probe();",
    "});",
    "void probe();",
    "})();",
  ].join("");
  return [
    "<!doctype html>",
    `<html lang="${language === "zh" ? "zh-CN" : "en"}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="theme-color" content="#0e1324">',
    `<title>${copy.title}</title>`,
    "<style>",
    "html{color-scheme:dark;background:#0e1324}",
    "body{min-height:100dvh;margin:0;display:grid;place-items:center;box-sizing:border-box;padding:max(32px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:#0e1324;color:#f7f8fb;font:15px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;text-align:center}",
    "main{width:min(100%,420px)}",
    "svg{width:72px;height:72px;display:block;margin:0 auto 24px}",
    "h1{margin:0;font-size:24px;line-height:1.25;letter-spacing:-.02em}",
    "p{margin:12px auto 24px;max-width:38ch;color:#b8becc}",
    "[data-minke-pwa-connecting-indicator]{display:flex;align-items:center;justify-content:center;gap:8px;min-height:24px;margin-bottom:20px;color:#d7dbea;font-size:13px}",
    "[data-minke-pwa-connecting-indicator]::before{width:8px;height:8px;border-radius:50%;background:#8da2ff;box-shadow:0 0 0 5px rgb(141 162 255 / 12%);content:\"\";animation:minke-pwa-pulse 1.4s ease-in-out infinite}",
    "button{min-height:42px;padding:0 18px;border:0;border-radius:12px;background:#f7f8fb;color:#0e1324;font:inherit;font-weight:650;cursor:pointer}",
    "button:hover{background:#fff}",
    "button:focus-visible{outline:3px solid #8da2ff;outline-offset:4px}",
    "::selection{background:#8da2ff;color:#0e1324}",
    "@keyframes minke-pwa-pulse{50%{opacity:.45;transform:scale(.72)}}",
    "@media(prefers-reduced-motion:reduce){[data-minke-pwa-connecting-indicator]::before{animation:none}}",
    "</style>",
    "</head>",
    "<body><main data-minke-pwa-connecting>",
    OFFLINE_ICON,
    `<h1>${copy.title}</h1>`,
    `<p>${copy.description}</p>`,
    '<div data-minke-pwa-connecting-indicator role="status" aria-live="polite">',
    `<span data-minke-pwa-connecting-status>${copy.retrying}</span>`,
    "</div>",
    `<button data-minke-pwa-connecting-action type="button">${copy.action}</button>`,
    "</main>",
    `<script>${retryScript}</script>`,
    "</body></html>",
  ].join("");
}

export const MINKE_PWA_SERVICE_WORKER = [
  '"use strict";',
  "const NAVIGATION_TIMEOUT_MS=1200;",
  `const CONNECTING_ZH=${JSON.stringify(connectingPage("zh"))};`,
  `const CONNECTING_EN=${JSON.stringify(connectingPage("en"))};`,
  `const OFFLINE_ZH=${JSON.stringify(offlinePage("zh"))};`,
  `const OFFLINE_EN=${JSON.stringify(offlinePage("en"))};`,
  "const localized=(request,zh,en)=>{",
  'const language=request.headers.get("accept-language")??"";',
  'return language.toLowerCase().startsWith("zh")?zh:en;',
  "};",
  "const htmlResponse=(body,allowScript=false)=>new Response(body,{",
  "status:503,",
  "headers:{",
  '"content-type":"text/html; charset=utf-8",',
  '"cache-control":"no-store",',
  '"content-security-policy":allowScript',
  '? "default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'self\'; base-uri \'none\'; form-action \'none\'"',
  ': "default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'",',
  '"x-content-type-options":"nosniff"',
  "}",
  "});",
  "const navigate=async(request)=>{",
  "const controller=new AbortController();",
  "let timedOut=false;",
  "let timeout;",
  "const network=fetch(request,{signal:controller.signal})",
  '.then((response)=>({kind:"network",response}))',
  '.catch(()=>({kind:timedOut?"timeout":"offline"}));',
  "const deadline=new Promise((resolve)=>{",
  "timeout=setTimeout(()=>{",
  "timedOut=true;",
  "controller.abort();",
  'resolve({kind:"timeout"});',
  "},NAVIGATION_TIMEOUT_MS);",
  "});",
  "const result=await Promise.race([network,deadline]);",
  "clearTimeout(timeout);",
  'if(result.kind==="network")return result.response;',
  'if(result.kind==="timeout"){',
  "return htmlResponse(",
  "localized(request,CONNECTING_ZH,CONNECTING_EN),",
  "true",
  ");",
  "}",
  "return htmlResponse(localized(request,OFFLINE_ZH,OFFLINE_EN));",
  "};",
  'self.addEventListener("install",(event)=>{',
  "event.waitUntil(self.skipWaiting());",
  "});",
  'self.addEventListener("activate",(event)=>{',
  "event.waitUntil(self.clients.claim());",
  "});",
  'self.addEventListener("fetch",(event)=>{',
  "const {request}=event;",
  'if(request.mode !== "navigate")return;',
  "event.respondWith(navigate(request));",
  "});",
  "",
].join("\n");

const PWA_LAUNCH_SHELL = [
  '<div data-minke-pwa-launch role="status" aria-live="polite" aria-label="Minke is starting">',
  OFFLINE_ICON,
  '<strong aria-hidden="true">Minke</strong>',
  '<span data-minke-pwa-launch-indicator aria-hidden="true"></span>',
  "</div>",
].join("");

const PWA_LAUNCH_STYLE = [
  '<style data-minke-pwa="launch">',
  "html{background:#0e1324}",
  "[data-minke-pwa-launch]{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;box-sizing:border-box;padding:max(32px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:#0e1324;color:#f7f8fb;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;transition:opacity .16s ease,visibility 0s linear .16s}",
  "[data-minke-pwa-launch] svg{display:block;width:68px;height:68px}",
  "[data-minke-pwa-launch] strong{font-size:18px;line-height:24px;font-weight:650;letter-spacing:.01em}",
  "[data-minke-pwa-launch-indicator]{width:18px;height:18px;box-sizing:border-box;border:2px solid rgb(247 248 251 / 20%);border-top-color:#f7f8fb;border-radius:50%;animation:minke-pwa-launch-spin .8s linear infinite}",
  "#root:has(> :not([data-minke-pwa-launch]))>[data-minke-pwa-launch]{visibility:hidden;opacity:0;pointer-events:none}",
  "@keyframes minke-pwa-launch-spin{to{transform:rotate(360deg)}}",
  "@media(prefers-reduced-motion:reduce){[data-minke-pwa-launch]{transition:none}[data-minke-pwa-launch-indicator]{animation-duration:1.6s}}",
  "</style>",
].join("");

export const MINKE_PWA_BOOTSTRAP = [
  "(()=>{",
  'const key="__minkePwa";',
  "const state=window[key]??{installPrompt:null};",
  "window[key]=state;",
  'window.addEventListener("beforeinstallprompt",(event)=>{',
  "event.preventDefault();",
  "state.installPrompt=event;",
  'window.dispatchEvent(new Event("minke:pwa-install-ready"));',
  "});",
  'window.addEventListener("appinstalled",()=>{',
  "state.installPrompt=null;",
  "});",
  'const launch=document.querySelector("[data-minke-pwa-launch]");',
  'const root=document.getElementById("root");',
  "if(launch&&root){",
  "const revealApp=()=>{",
  "if([...root.children].some((child)=>child!==launch)){",
  "launch.remove();",
  "state.launchObserver?.disconnect();",
  "state.launchObserver=undefined;",
  "}",
  "};",
  "state.launchObserver=new MutationObserver(revealApp);",
  "state.launchObserver.observe(root,{childList:true});",
  "revealApp();",
  "}",
  'if("serviceWorker" in navigator&&window.isSecureContext){',
  `state.serviceWorker=navigator.serviceWorker.register(${JSON.stringify(
    MINKE_PWA_ROUTES.serviceWorker,
  )},{scope:"/",updateViaCache:"none"}).catch((error)=>{`,
  "state.serviceWorkerError=error instanceof Error?error.message:String(error);",
  "return undefined;",
  "});",
  "}",
  "})();",
  "",
].join("\n");

const PWA_HEAD_MARKER = 'data-minke-pwa="head"';

/** Add PWA metadata before application modules execute. */
export function injectMinkePwaHead(html: string): string {
  if (html.includes(PWA_HEAD_MARKER)) return html;

  const iconLink =
    `<link rel="icon" type="image/svg+xml" href="${MINKE_PWA_ROUTES.iconSvg}">`;
  const favicon = /<link\s+rel=(["'])icon\1[^>]*>/iu;
  let output = favicon.test(html)
    ? html.replace(favicon, iconLink)
    : html;
  const viewportTag =
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';
  const viewport =
    /<meta\b(?=[^>]*\bname=(["'])viewport\1)[^>]*>/iu;
  const hasViewport = viewport.test(output);
  if (hasViewport) {
    output = output.replace(viewport, viewportTag);
  }
  const hasManifest =
    /<link\s+rel=(["'])manifest\1[^>]*>/iu.test(output);
  const metadata = [
    `<meta ${PWA_HEAD_MARKER} name="application-name" content="Minke">`,
    hasViewport ? "" : viewportTag,
    '<meta name="theme-color" content="#0e1324">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
    '<meta name="apple-mobile-web-app-title" content="Minke">',
    hasManifest
      ? ""
      : `<link rel="manifest" href="${MINKE_PWA_ROUTES.manifest}">`,
    favicon.test(html) ? "" : iconLink,
    `<link rel="apple-touch-icon" sizes="180x180" href="${MINKE_PWA_ROUTES.appleTouchIcon}">`,
    PWA_LAUNCH_STYLE,
    `<script defer src="${MINKE_PWA_ROUTES.bootstrap}"></script>`,
  ].filter((entry) => entry !== "").join("\n    ");
  const moduleScript =
    /<script\b[^>]*\btype=(["'])module\1[^>]*>/iu;
  if (moduleScript.test(output)) {
    output = output.replace(moduleScript, `${metadata}\n    $&`);
  } else {
    output = output.replace(
      /<\/head>/iu,
      `    ${metadata}\n  </head>`,
    );
  }
  const emptyRoot =
    /(<div\b[^>]*\bid=(["'])root\2[^>]*>)\s*(<\/div>)/iu;
  if (emptyRoot.test(output)) {
    return output.replace(
      emptyRoot,
      (_match, open: string, _quote: string, close: string) =>
        `${open}${PWA_LAUNCH_SHELL}${close}`,
    );
  }
  return output.replace(
    /<body\b[^>]*>/iu,
    `$&${PWA_LAUNCH_SHELL}`,
  );
}

interface PwaWebRoute {
  readonly kind: "exact";
  readonly path: string;
  readonly handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>;
}

export interface PwaWebServer {
  register(route: PwaWebRoute): () => void;
  tapIndex(transform: (html: string) => string): () => void;
}

interface PwaResponse {
  readonly body: string | Uint8Array;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly serviceWorker?: boolean;
}

const assetCache = new Map<string, Promise<Uint8Array>>();

async function readPwaAsset(name: string): Promise<Uint8Array> {
  let cached = assetCache.get(name);
  if (cached !== undefined) return cached;
  cached = (async () => {
    const candidates = [
      new URL(`../assets/pwa/${name}`, import.meta.url),
      new URL(`../../assets/pwa/${name}`, import.meta.url),
    ];
    let failure: unknown;
    for (const candidate of candidates) {
      try {
        return await readFile(candidate);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  })();
  assetCache.set(name, cached);
  return cached;
}

function sendPwaResponse(
  request: IncomingMessage,
  response: ServerResponse,
  resource: PwaResponse,
): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": resource.contentType,
    "cache-control": resource.cacheControl,
    "x-content-type-options": "nosniff",
    ...(resource.serviceWorker === true
      ? { "service-worker-allowed": "/" }
      : {}),
  });
  response.end(
    request.method === "HEAD" ? undefined : resource.body,
  );
}

/** Register the Web-only install resources without touching Electron files. */
export function installMinkePwaHost(
  webServer: PwaWebServer,
): () => void {
  const text = (
    path: string,
    body: string,
    contentType: string,
    serviceWorker = false,
  ): (() => void) =>
    webServer.register({
      kind: "exact",
      path,
      handler(request, response) {
        sendPwaResponse(request, response, {
          body,
          contentType,
          cacheControl: "no-cache",
          serviceWorker,
        });
      },
    });
  const asset = (
    path: string,
    name: string,
    contentType: string,
  ): (() => void) =>
    webServer.register({
      kind: "exact",
      path,
      async handler(request, response) {
        sendPwaResponse(request, response, {
          body: await readPwaAsset(name),
          contentType,
          cacheControl: "public, max-age=31536000, immutable",
        });
      },
    });
  const disposers = [
    webServer.tapIndex(injectMinkePwaHead),
    text(
      MINKE_PWA_ROUTES.manifest,
      MINKE_PWA_MANIFEST,
      "application/manifest+json; charset=utf-8",
    ),
    text(
      MINKE_PWA_ROUTES.bootstrap,
      MINKE_PWA_BOOTSTRAP,
      "text/javascript; charset=utf-8",
    ),
    text(
      MINKE_PWA_ROUTES.serviceWorker,
      MINKE_PWA_SERVICE_WORKER,
      "text/javascript; charset=utf-8",
      true,
    ),
    asset(
      MINKE_PWA_ROUTES.iconSvg,
      "icon.svg",
      "image/svg+xml",
    ),
    asset(
      MINKE_PWA_ROUTES.icon192,
      "icon-192.png",
      "image/png",
    ),
    asset(
      MINKE_PWA_ROUTES.icon512,
      "icon-512.png",
      "image/png",
    ),
    asset(
      MINKE_PWA_ROUTES.maskableIcon512,
      "icon-maskable-512.png",
      "image/png",
    ),
    asset(
      MINKE_PWA_ROUTES.appleTouchIcon,
      "apple-touch-icon.png",
      "image/png",
    ),
  ];
  return () => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      disposers[index]?.();
    }
  };
}
