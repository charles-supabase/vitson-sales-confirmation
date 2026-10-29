import { useEffect, useRef } from "react";

const openModals = []; // stack of open modals; Escape only closes the top one

export default function Modal({ open, title, onClose, children, footer, size = "md", layer = "" }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const token = {};
    openModals.push(token);
    const onKey = (e) => {
      if (e.key === "Escape" && openModals[openModals.length - 1] === token) closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(token), 1);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={`overlay ${layer === "top" ? "overlay-top" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
