import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "danger";
  compact?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = "default", compact = false, className = "", ...props },
  ref,
) {
  return <button ref={ref} className={`ui-button ${tone !== "default" ? `is-${tone}` : ""} ${compact ? "is-compact" : ""} ${className}`.trim()} {...props} />;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function IconButton(
  { className = "", ...props },
  ref,
) {
  return <button ref={ref} className={`ui-icon-button ${className}`.trim()} {...props} />;
});

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { className = "", ...props },
  ref,
) {
  return <input ref={ref} className={`ui-text-field ${className}`.trim()} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className = "", ...props },
  ref,
) {
  return <textarea ref={ref} className={`ui-text-area ${className}`.trim()} {...props} />;
});

export function Checkbox({ checked, onChange, children, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return <label className={`ui-checkbox${disabled ? " is-disabled" : ""}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span aria-hidden="true">{checked ? <Check size={12} /> : null}</span>
    {children ? <em>{children}</em> : null}
  </label>;
}

export type ComboboxOption = { value: string; label: string; detail?: string; disabled?: boolean };

export function Combobox({ value, options, onChange, placeholder = "请选择", searchPlaceholder = "搜索", ariaLabel, disabled = false }: {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="ui-combobox" ref={rootRef}>
    <Button
      type="button"
      className="ui-combobox-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
    >
      <span>{selected?.label ?? (value || placeholder)}</span><ChevronDown size={13} />
    </Button>
    {open ? <div className="ui-popover ui-combobox-popover">
      <TextField autoFocus type="search" value={query} aria-label={`${ariaLabel}搜索`} placeholder={searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
      <div className="ui-combobox-options" role="listbox" aria-label={ariaLabel}>
        {filtered.map((option) => <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          key={option.value}
          onClick={() => {
            onChange(option.value);
            setQuery("");
            setOpen(false);
          }}
        >
          <span>{option.label}</span>{option.detail ? <small>{option.detail}</small> : null}
          {option.value === value ? <Check size={13} /> : null}
        </button>)}
        {filtered.length === 0 ? <p>没有匹配项</p> : null}
      </div>
    </div> : null}
  </div>;
}

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };
type ToastContextValue = { pushToast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue>({ pushToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());
  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const pushToast = useCallback((message: string, tone: ToastTone = "info") => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current, { id, tone, message }]);
    timers.current.set(id, window.setTimeout(() => remove(id), tone === "error" ? 8000 : 4000));
  }, [remove]);
  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);
  return <ToastContext.Provider value={{ pushToast }}>
    {children}
    <div className="ui-toast-region" aria-live="polite" aria-relevant="additions removals">
      {items.map((item) => <div className={`ui-toast is-${item.tone}`} key={item.id} role={item.tone === "error" ? "alert" : "status"}>
        <span>{item.message}</span>
        <IconButton type="button" aria-label="关闭通知" onClick={() => remove(item.id)}><X size={13} /></IconButton>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  return useContext(ToastContext);
}

export function Menu({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-menu ${className}`.trim()} role="menu">{children}</div>;
}

export function Popover({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-popover ${className}`.trim()}>{children}</div>;
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="ui-dialog-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ui-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><strong>{title}</strong><IconButton aria-label="关闭" onClick={onClose}><X size={14} /></IconButton></header>
      {children}
    </section>
  </div>;
}

export function Splitter({ orientation, label, onPointerDown }: {
  orientation: "horizontal" | "vertical";
  label: string;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
}) {
  return <div className={`ui-splitter is-${orientation}`} role="separator" aria-label={label} aria-orientation={orientation} onPointerDown={onPointerDown} />;
}
