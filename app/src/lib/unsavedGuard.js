import { useEffect, useRef } from "react";

// Anything with unsaved changes registers here while it is mounted. Navigation (tabs, dashboard buttons) asks
// hasUnsavedChanges() first and shows the in-app "exit without saving" popup.
const checks = new Set();

export const hasUnsavedChanges = () => [...checks].some((isDirty) => isDirty());

export function useUnsavedGuard(isDirty) {
  const ref = useRef(isDirty);
  ref.current = isDirty;
  useEffect(() => {
    const check = () => ref.current;
    checks.add(check);
    return () => checks.delete(check);
  }, []);
}

/** The popup spec used everywhere (see confirmAction in App.jsx). */
export const unsavedPrompt = (onConfirm) => ({
  title: "Unsaved changes",
  message: "You have changes that are not saved. Exit without saving them?",
  confirmLabel: "Exit without saving",
  cancelLabel: "Keep editing",
  onConfirm,
});
