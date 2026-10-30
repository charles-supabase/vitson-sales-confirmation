import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setAppToken, supabase } from "./supabase.js";

// Modules = the dashboard items. A user sees (and the database allows) only the ones in their list.
export const MODULES = { entry: "sales_confirmations", jobOrders: "job_orders", recipes: "recipe", tracking: "tracking", deliveries: "deliveries" };

const KEY = "vitson-session";
const CHECK_EVERY = 5 * 60 * 1000;

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const readToken = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const writeToken = (t) => {
  try {
    if (t) window.localStorage.setItem(KEY, t);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session simply isn't remembered */
  }
};

// One call to the Edge Function; a network problem answers { ok: false, code: "network" }
async function callGate(body) {
  try {
    const { data, error } = await supabase.functions.invoke("app-login", { body });
    if (error && !data) return { ok: false, code: "network" };
    return data ?? { ok: false, code: "network" };
  } catch {
    return { ok: false, code: "network" };
  }
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); // checking | out | in
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState(""); // why the user was signed out (shown on the login screen)
  const statusRef = useRef(status);
  statusRef.current = status;

  const signedOut = useCallback((why = "") => {
    setAppToken(null);
    writeToken(null);
    setUser(null);
    setMessage(why);
    setStatus("out");
  }, []);

  // Is the stored session still good (and still from the office, for regular users)?
  const verify = useCallback(async () => {
    const res = await callGate({ action: "verify" });
    if (res.ok) {
      setUser(res.user);
      setStatus("in");
      return true;
    }
    if (res.code === "network") return statusRef.current === "in"; // can't tell: keep what we have
    signedOut(res.code === "outside_office" ? "This account can only be used from the office network." : res.code === "expired" ? "Your session has ended. Please sign in again." : "");
    return false;
  }, [signedOut]);

  useEffect(() => {
    const t = readToken();
    if (!t) {
      setStatus("out");
      return;
    }
    setAppToken(t);
    verify().then((ok) => {
      if (!ok && statusRef.current === "checking") setStatus("out");
    });
  }, [verify]);

  useEffect(() => {
    if (status !== "in") return undefined;
    const timer = setInterval(verify, CHECK_EVERY);
    const onFocus = () => verify();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [status, verify]);

  const login = useCallback(async (username, password) => {
    const res = await callGate({ action: "login", username, password });
    if (res.ok) {
      setAppToken(res.token);
      writeToken(res.token);
      setUser(res.user);
      setMessage("");
      setStatus("in");
    }
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.rpc("app_logout");
    } catch {
      /* the token is dropped below either way */
    }
    signedOut("");
  }, [signedOut]);

  const changePassword = useCallback(async (oldPassword, newPassword) => {
    const { data, error } = await supabase.rpc("app_change_password", { p_old: oldPassword, p_new: newPassword });
    if (error) return { ok: false, code: "network" };
    return data;
  }, []);

  const checkConnection = useCallback(() => callGate({ action: "ip-check" }), []);

  const value = useMemo(
    () => ({
      status,
      user,
      message,
      login,
      logout,
      changePassword,
      checkConnection,
      can: (module) => Boolean(user?.modules?.includes(module)),
    }),
    [status, user, message, login, logout, changePassword, checkConnection]
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
