import { Brand } from "@easy-proto/ui";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import fold from "@easy-proto/ui/fold.svg";
import chrome from "../chrome.module.css";
import styles from "./landing.module.css";

export function Landing() {
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
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
      <header className={`${chrome.header} ${styles.siteHeader}`}>
        <Link to="/" aria-label="Easy Proto home">
          <Brand />
        </Link>
        <span className={`${chrome.headerMeta} ${styles.headerMeta}`}>
          A personal canvas for agent-made ideas.
        </span>
      </header>
      <main className={styles.landingMain}>
        <section className={styles.landingHero} aria-labelledby="landing-title">
          <img className={styles.landingMark} src={fold} alt="" />
          <h1 id="landing-title">Easy Proto</h1>
          <p>
            Create with agents. Keep your files.
            <br />
            Share a page when it’s ready.
          </p>
          <form className={styles.waitlistForm} onSubmit={(event) => void join(event)}>
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
                : "Just a note when Easy Proto is ready.")}
          </p>
        </section>
      </main>
      <footer className={styles.landingFooter}>Built for macOS. Shared on the web.</footer>
    </div>
  );
}
