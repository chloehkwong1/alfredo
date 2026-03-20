import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Fast theme apply from cache (avoids flash)
const cachedTheme = localStorage.getItem("alfredo-theme");
if (cachedTheme && cachedTheme !== "warm-dark") {
  document.documentElement.setAttribute("data-theme", cachedTheme);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
