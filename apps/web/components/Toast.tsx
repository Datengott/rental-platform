"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconClose } from "./Icons";

type ToastKind = "success" | "error";

// A tiny transient message. `show` is referentially stable so it can be a
// dependency of other hooks without re-triggering their effects.
export function useToast() {
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((kind: ToastKind, text: string) => {
    setToast({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const node = toast ? (
    <div className={`toast ${toast.kind === "error" ? "error" : ""}`} role="status" aria-live="polite">
      <span className="dot">{toast.kind === "error" ? <IconClose size={13} /> : <IconCheck size={13} />}</span>
      {toast.text}
    </div>
  ) : null;

  return { show, node };
}
