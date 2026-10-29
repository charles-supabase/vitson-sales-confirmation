// Small inline icons (no icon library needed). All are decorative: the buttons that hold them carry the label.
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false };

export const PencilIcon = (p) => (
  <svg {...base} {...p}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
);
export const TrashIcon = (p) => (
  <svg {...base} {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
);
export const MenuIcon = (p) => (
  <svg {...base} {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
);
export const SearchIcon = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
export const FileIcon = (p) => (
  <svg {...base} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
);
export const ListIcon = (p) => (
  <svg {...base} {...p}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
);
export const FlaskIcon = (p) => (
  <svg {...base} {...p}><path d="M9 3h6" /><path d="M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" /><line x1="7.5" y1="15" x2="16.5" y2="15" /></svg>
);

const ICONS = { edit: PencilIcon, delete: TrashIcon };

/** A bordered icon button for list rows. kind: "edit" | "delete". */
export function IconButton({ kind, label, onClick, disabled }) {
  const Icon = ICONS[kind];
  return (
    <button type="button" className={`icon-action icon-${kind}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon />
    </button>
  );
}
