import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { useAuth } from "../lib/auth.jsx";

const MESSAGES = {
  bad_credentials: "The current password is wrong.",
  too_short: "The new password needs at least 8 characters.",
  expired: "Your session has ended. Sign in again.",
  network: "Couldn't reach the server. Try again.",
};

export default function ChangePasswordDialog({ open, onClose, onDone }) {
  const { changePassword } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setOldPw("");
      setNewPw("");
      setAgain("");
      setError("");
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (newPw.length < 8) return setError(MESSAGES.too_short);
    if (newPw !== again) return setError("The two new passwords are not the same.");
    setBusy(true);
    const res = await changePassword(oldPw, newPw);
    setBusy(false);
    if (!res?.ok) return setError(MESSAGES[res?.code] ?? "Couldn't change the password.");
    onClose();
    onDone?.();
  };

  return (
    <Modal
      open={open}
      title="Change password"
      size="sm"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="pw-form" className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : "Change password"}</button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} noValidate>
        {error && <div className="banner banner-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="pw-old">Current password</label>
          <input id="pw-old" type="password" autoComplete="current-password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw-again">New password again</label>
          <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
