import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";

type ToastScope = "workspace" | "tokens";
type Toast = { message: string; scope: ToastScope };
const ToastContext = createContext<{
  toast?: Toast;
  notify(message: string, scope?: ToastScope): void;
  dismiss(scope: ToastScope): void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>();
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider
      value={{
        toast,
        notify: (message, scope = "workspace") => setToast({ message, scope }),
        dismiss: (scope) => setToast((current) => (current?.scope === scope ? undefined : current)),
      }}
    >
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext)!;
}

export function ToastViewport({ scope = "workspace" }: { scope?: ToastScope }) {
  const { toast, dismiss } = useToast();
  const message = toast?.scope === scope ? toast.message : "";
  return (
    <div className="toast-viewport">
      <span role="status" aria-atomic="true" className="screen-reader-only">
        {message}
      </span>
      {message && (
        <div className="toast">
          <Check size={15} aria-hidden="true" />
          <span aria-hidden="true">{message}</span>
          <button
            className="toast-dismiss"
            aria-label="Dismiss notification"
            type="button"
            onClick={() => dismiss(scope)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
