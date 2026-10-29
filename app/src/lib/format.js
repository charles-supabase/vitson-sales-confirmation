// Change these to match your books and scale.
export const CURRENCY = "PHP";
export const WEIGHT_UNIT = "kg";
export const VOLUME_UNIT = "L";

const money = new Intl.NumberFormat("en", { style: "currency", currency: CURRENCY });
const weight = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export const formatMoney = (n) => (n === null || n === undefined ? "None" : money.format(Number(n)));
export const formatWeight = (n) => `${weight.format(Number(n ?? 0))} ${WEIGHT_UNIT}`;
const volume = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
export const formatVolume = (n) => `${volume.format(Number(n ?? 0))} ${VOLUME_UNIT}`;
const usDate = new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
export const formatDateUS = (d) => (d ? usDate.format(new Date(`${d}T00:00:00`)) : "");
export const formatInt = (n) => Math.round(Number(n ?? 0)).toLocaleString("en");
export const formatDate = (d) => (d ? date.format(new Date(`${d}T00:00:00`)) : "None");
export const formatDateTime = (d) => (d ? dateTime.format(new Date(d)) : "Never");

// Job tickets are shown as xx-xxxxx-x-xx-x (groups of 2, 5, 1, 2 and 1). Anything that doesn't fit is shown as it is.
export function formatTicket(raw) {
  if (raw === null || raw === undefined) return "";
  const text = String(raw);
  const compact = text.replace(/[\s-]/g, "");
  if (compact.length === 0 || compact.length > 11) return text;
  const parts = [];
  let i = 0;
  for (const size of [2, 5, 1, 2, 1]) {
    if (i >= compact.length) break;
    parts.push(compact.slice(i, i + size));
    i += size;
  }
  return parts.join("-");
}
/**
 * Live formatting while typing: A#-#####-#-AA-# (A = letter, # = digit, 11 characters). With `strict`, a character that doesn't
 * fit its position is ignored and letters become capitals; without it (searches, old tickets) any character is kept.
 */
const TICKET_SHAPE = "LDDDDDDDLLD";
export function typingTicket(raw, strict = false) {
  let compact = String(raw ?? "").replace(/[\s-]/g, "");
  if (strict) {
    let out = "";
    for (const ch of compact.toUpperCase()) {
      if (out.length >= TICKET_SHAPE.length) break;
      const ok = TICKET_SHAPE[out.length] === "L" ? /[A-Z]/.test(ch) : /[0-9]/.test(ch);
      if (ok) out += ch;
    }
    compact = out;
  } else {
    compact = compact.slice(0, 11);
  }
  return compact ? formatTicket(compact) : "";
}
/** A complete ticket in the A#-#####-#-AA-# pattern (with or without dashes). */
export const isTicket = (v) => /^[A-Z]\d{7}[A-Z]{2}\d$/.test(String(v ?? "").replace(/[\s-]/g, "").toUpperCase());
/** What is stored: the ticket without dashes or spaces. */
export const rawTicket = (v) => String(v ?? "").replace(/[\s-]/g, "");
/** For comparing tickets typed with or without dashes. */
export const compactTicket = (v) => String(v ?? "").replace(/[\s-]/g, "").toLowerCase();

export const today = () => new Date().toISOString().slice(0, 10);
export const toInt = (v) => (v === "" || v === null || v === undefined ? null : Math.trunc(Number(v)));
export const toNum = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
export const toId = toInt;
export const toText = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
