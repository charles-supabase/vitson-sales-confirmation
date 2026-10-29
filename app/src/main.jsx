import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LockProvider } from "./lib/lock.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LockProvider>
      <App />
    </LockProvider>
  </React.StrictMode>
);
