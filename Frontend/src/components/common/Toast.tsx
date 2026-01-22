import React, { useEffect, useState } from "react";
import "./toast.css";

type ToastItem = {
  id: number;
  message: string;
  kind?: "success" | "error" | "info" | "warn";
  actionLabel?: string;
  actionEvent?: string;
  actionPayload?: any;
};

export default function ToastManager() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handler(e: any) {
      const { message, kind, actionLabel, actionEvent, actionPayload } = e.detail || {};
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const item: ToastItem = {
        id,
        message: String(message),
        kind: kind || "info",
        actionLabel: actionLabel || undefined,
        actionEvent: actionEvent || undefined,
        actionPayload: actionPayload || undefined,
      };
      setToasts((t) => [...t, item]);
      // auto-dismiss
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    }
    window.addEventListener("ai_toast", handler as EventListener);
    return () => window.removeEventListener("ai_toast", handler as EventListener);
  }, []);

  return (
    <div className="ai-toast-root" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ai-toast ${t.kind || "info"}`} role="status">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>{t.message}</div>
            {t.actionLabel ? (
              <button
                className="ai-toast-action"
                onClick={() => {
                  if (t.actionEvent) {
                    window.dispatchEvent(new CustomEvent(t.actionEvent, { detail: t.actionPayload }));
                  }
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
