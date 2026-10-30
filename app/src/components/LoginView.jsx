import { useState } from "react";
import { useAuth } from "../lib/auth.jsx";

const MESSAGES = {
  bad_credentials: "The user or the password is wrong.",
  locked: "Too many wrong passwords. Try again in 15 minutes.",
  outside_office: "This account can only sign in from the office network.",
  network: "Couldn't reach the server. Check the connection and try again.",
  server: "The server had a problem. Try again in a moment.",
};

export default function LoginView() {
  const { login, message, checkConnection } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conn, setConn] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError("Enter the user and the password.");
    setBusy(true);
    setError("");
    const res = await login(username.trim(), password);
    setBusy(false);
    if (!res.ok) {
      setError(MESSAGES[res.code] ?? "Couldn't sign in.");
      setPassword("");
    }
  };

  const check = async () => {
    setConn({ loading: true });
    setConn(await checkConnection());
  };

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">V</span>
          <span className="brand-name">Vitson</span>
        </div>
        <h1>Sign in</h1>
        {message && !error && <div className="banner banner-warn" role="status">{message}</div>}
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="login-user">User</label>
          <input id="login-user" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="login-pass">Password</label>
          <input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary login-btn" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>

        <div className="login-conn">
          <button type="button" className="link-btn" onClick={check}>Check connection</button>
          {conn?.loading && <span> checking...</span>}
          {conn && !conn.loading && (
            <p>
              {conn.ok
                ? <>This computer is seen as <b>{conn.ip || "unknown"}</b>: {conn.in_office ? "office network." : conn.office_configured ? "not the office network." : "the office address is not set on the server."}</>
                : "Couldn't check the connection."}
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
