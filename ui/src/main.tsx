import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./App";
import { PopoutApp } from "./layout/PopoutApp";
import { boot } from "./store/boot";

// Wire the transport and stores once, before the first render.
boot();

// "#/xsec" is the cross-section pop-out window; everything else is the main app.
const isPopout = window.location.hash.startsWith("#/xsec");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPopout ? <PopoutApp /> : <App />}</React.StrictMode>,
);
