import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Sign in</h1>
        <p>This network address requires a password before you can use Movie Night Manager.</p>
        <Suspense fallback={<p className={styles.error}>Loading…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
