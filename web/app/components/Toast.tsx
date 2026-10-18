"use client";

import styles from "./Toast.module.css";

type ToastProps = {
  message: string;
  type: "success" | "error";
  onDismiss: () => void;
};

export function Toast({ message, type, onDismiss }: ToastProps) {
  return (
    <div
      className={`${styles.toast} ${type === "success" ? styles.success : styles.error}`}
      role="status"
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
