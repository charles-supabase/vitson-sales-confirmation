import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_VITSON_SUPABASE_URL;
const key = import.meta.env.VITE_VITSON_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_VITSON_SUPABASE_URL or VITE_VITSON_SUPABASE_ANON_KEY. Copy .env.example to .env.");
}

// The signed-in user's session token (from the app-login Edge Function). Every request carries it in x-app-token;
// the database policies let a request through only with a valid token (sql/13_lock_down.sql).
let appToken = null;
export const setAppToken = (t) => {
  appToken = t || null;
};
const withToken = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (appToken) headers.set("x-app-token", appToken);
  return fetch(input, { ...init, headers });
};

// The app only ever talks to vitson-recipe. Customers arrive there through the
// sync webhook, so no charles-supabase client (or key) exists in the browser.
// Users are the app's own (tbl_app_user), not Supabase Auth, so Auth's session handling is off.
export const supabase = createClient(url, key, {
  global: { fetch: withToken },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
