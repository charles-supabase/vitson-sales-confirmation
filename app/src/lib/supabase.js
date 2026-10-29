import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_VITSON_SUPABASE_URL;
const key = import.meta.env.VITE_VITSON_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_VITSON_SUPABASE_URL or VITE_VITSON_SUPABASE_ANON_KEY. Copy .env.example to .env.");
}

// The app only ever talks to vitson-recipe. Customers arrive there through the
// sync webhook, so no charles-supabase client (or key) exists in the browser.
export const supabase = createClient(url, key);
