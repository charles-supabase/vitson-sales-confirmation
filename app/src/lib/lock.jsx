import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal.jsx";
import { copiedJobOrderIds } from "./salesApi.js";

// Once a delivery is marked copied (tbl_Delivery.copied = true) its job order, fabric rolls, delivery and delivered
// rolls can be viewed but not changed until someone enters this password. The unlock lasts until the page is reloaded.
const UNLOCK_PASSWORD = "1688";

const LockCtx = createContext({ unlocked: new Set(), requestUnlock: () => {} });
export const useLock = () => useContext(LockCtx);

export function LockProvider({ children }) {
  const [unlocked, setUnlocked] = useState(() => new Set());
  const [ask, setAsk] = useState(null); // { id, after }
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  const requestUnlock = useCallback((id, after) => {
    setPass("");
    setError("");
    setAsk({ id, after });
  }, []);
  const close = () => setAsk(null);
  const submit = (e) => {
    e.preventDefault();
    if (pass !== UNLOCK_PASSWORD) {
      setError("Wrong password.");
      setPass("");
      return;
    }
    const { id, after } = ask;
    setUnlocked((prev) => new Set(prev).add(id));
    setAsk(null);
    after?.();
  };

  const value = useMemo(() => ({ unlocked, requestUnlock }), [unlocked, requestUnlock]);
  return (
    <LockCtx.Provider value={value}>
      {children}
      <Modal
        open={Boolean(ask)}
        title="Locked record"
        size="sm"
        layer="top"
        onClose={close}
        footer={
          <>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" form="unlock-form" className="btn btn-primary">Unlock</button>
          </>
        }
      >
        <form id="unlock-form" onSubmit={submit} noValidate>
          <p className="modal-text">This job order has already been copied, so it can only be viewed. Enter the password to edit it.</p>
          <div className={`field ${error ? "has-error" : ""}`}>
            <label htmlFor="unlock-pass">Password</label>
            <input id="unlock-pass" type="password" autoComplete="off" autoFocus value={pass} onChange={(e) => { setPass(e.target.value); setError(""); }} />
            {error && <p className="field-error">{error}</p>}
          </div>
        </form>
      </Modal>
    </LockCtx.Provider>
  );
}

/** Job orders (by id) whose delivery is copied, plus the helpers to ask whether one is locked right now. */
export function useJobOrderLocks(ids, version = 0) {
  const { unlocked, requestUnlock } = useLock();
  const [copied, setCopied] = useState(() => new Set());
  const key = ids.filter((i) => i !== null && i !== undefined).join(",");
  useEffect(() => {
    let cancelled = false;
    const list = key ? [...new Set(key.split(",").map(Number))] : [];
    if (list.length === 0) {
      setCopied(new Set());
      return undefined;
    }
    copiedJobOrderIds(list)
      .then((s) => !cancelled && setCopied(s))
      .catch(() => !cancelled && setCopied(new Set())); // can't tell: don't block the user
    return () => {
      cancelled = true;
    };
  }, [key, version]);
  return {
    isLocked: (id) => id !== null && id !== undefined && copied.has(Number(id)) && !unlocked.has(Number(id)),
    unlock: (id, after) => requestUnlock(Number(id), after),
  };
}

export function LockBanner({ onUnlock, what = "job order and its delivery" }) {
  return (
    <div className="banner banner-lock" role="status">
      <span>Locked: this {what} has been copied, so it can only be viewed.</span>
      <button type="button" className="btn btn-orange btn-small" onClick={onUnlock}>Unlock to edit</button>
    </div>
  );
}
