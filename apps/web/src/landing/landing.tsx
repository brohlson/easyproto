import { Brand, EdgeRunner, WorkspaceHeader } from "@easy-proto/ui";
import { useEffect, useState, type FormEvent } from "react";
import chrome from "../chrome.module.css";
import styles from "./landing.module.css";
import { homeDescription } from "./content";

export function Landing() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setReady(true), []);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || joined) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), website: fields.get("website") }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 400
            ? "Enter a valid email address."
            : "We couldn’t save your email. Please try again.",
        );
      setJoined(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.landingPage}>
      <WorkspaceHeader
        brand={
          <a href="/" aria-label="Easy Proto home">
            <Brand />
          </a>
        }
      />
      <main className={styles.landingMain}>
        <section className={styles.landingHero} aria-labelledby="landing-title">
          <EdgeRunner className={styles.landingMark} animated />
          <h1 id="landing-title">Easy Proto</h1>
          <p>{homeDescription}</p>
          <form
            className={styles.waitlistForm}
            inert={!ready}
            onSubmit={(event) => void join(event)}
          >
            <label className={styles.visuallyHidden} htmlFor="waitlist-email">
              Email address
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder="Your email address"
              required
              disabled={joined}
              aria-describedby="waitlist-status"
            />
            <div className={styles.honeypot} aria-hidden="true">
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <button className={chrome.button} disabled={pending || joined}>
              {joined ? "You’re on the list" : pending ? "Joining…" : "Join the waitlist"}
            </button>
          </form>
          <p
            id="waitlist-status"
            role="status"
            className={error ? styles.waitlistError : styles.waitlistNote}
          >
            {error ||
              (joined
                ? "Thanks. We’ll be in touch when Easy Proto is ready."
                : "We’ll send you a message when Easy Proto is ready.")}
          </p>
        </section>
      </main>
    </div>
  );
}
