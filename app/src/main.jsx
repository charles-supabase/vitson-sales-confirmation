import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import LoginView from "./components/LoginView.jsx";
import { AuthProvider, useAuth } from "./lib/auth.jsx";
import { LockProvider } from "./lib/lock.jsx";
import "./styles.css";

// Nothing of the app loads before a user has signed in
function Root() {
  const { status } = useAuth();
  if (status === "checking") return <p className="login-checking">Loading...</p>;
  if (status !== "in") return <LoginView />;
  return (
    <LockProvider>
      <App />
    </LockProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>
);
