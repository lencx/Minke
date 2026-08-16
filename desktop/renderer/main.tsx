import React from "react";
import ReactDOM from "react-dom/client";
import {
  resolveDesktopLocale,
} from "../locale-contract";
import App from "./App";
import "./styles.css";

const locale = resolveDesktopLocale(
  new URLSearchParams(window.location.search).get("locale"),
);
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App locale={locale} />
  </React.StrictMode>,
);
