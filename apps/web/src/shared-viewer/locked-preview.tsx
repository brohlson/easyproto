import { Brand, WorkspaceHeader } from "@easy-proto/ui";
import { useState, type FormEvent } from "react";
import chrome from "../chrome.module.css";
import styles from "./locked-preview.module.css";

export function LockedPreview({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const password = String(new FormData(event.currentTarget).get("password") ?? "").trim();
    try {
      const response = await fetch(`/api/previews/${id}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        location.reload();
        return;
      }
      setMessage(
        response.status === 401
          ? "Incorrect password."
          : response.status === 429
            ? "Too many attempts. Try again in a few minutes."
            : "Couldn’t unlock this preview.",
      );
    } catch {
      setMessage("Couldn’t connect. Try again.");
    }
    setBusy(false);
  }
  return (
    <>
      <WorkspaceHeader
        brand={
          <a href="/" aria-label="Easy Proto home">
            <Brand />
          </a>
        }
      />
      <main className={styles.viewport}>
        <form className={styles.card} onSubmit={(event) => void unlock(event)}>
          <h1>Password required</h1>
          <p>Enter the password from the person who shared this preview.</p>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </label>
          {message && <p role="alert">{message}</p>}
          <button className={chrome.button} type="submit" disabled={busy}>
            Unlock preview
          </button>
        </form>
      </main>
    </>
  );
}
