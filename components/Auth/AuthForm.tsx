"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./AuthForm.module.css";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleGuestLogin() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      const guestEmail = "test@example.com";
      const guestPassword = "password123";

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: guestEmail,
        password: guestPassword,
      });

      if (signInErr) {
        throw signInErr;
      }

      router.push("/library");
      router.refresh();
    } catch (e: any) {
      console.error("Guest login failed:", e);
      setError(e.message || "Failed to sign in as guest.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/library");
    router.refresh();
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Left Side: Features Showcase */}
        <div className={styles.featuresShowcase}>
          <div className={styles.brandContainer}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192-removebg.png" alt="" width={48} height={48} className={styles.brandLogo} />
            <div>
              <div className={styles.brand}>Colophon</div>
              <div className={styles.tagline}>Your library, read aloud</div>
            </div>
          </div>
          
          <h2 className={styles.featuresTitle}>Elevate Your Reading Experience</h2>
          
          <div className={styles.featuresGrid}>
            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>⚡</span>
              <div className={styles.featureBody}>
                <h4>Smart AI Summaries</h4>
                <p>Instantly extract key takeaways, structural summaries, or outlines from any book page in one click.</p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>🎙️</span>
              <div className={styles.featureBody}>
                <h4>Premium AI Voices</h4>
                <p>Listen to books with natural Azure-powered TTS narration. Speed, pitch, and accent configurations are fully adjustable.</p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>🎴</span>
              <div className={styles.featureBody}>
                <h4>3D Flippable Flashcards</h4>
                <p>Auto-generate interactive study card decks based on your reading pages to practice active recall.</p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>📖</span>
              <div className={styles.featureBody}>
                <h4>Open Library Sharing</h4>
                <p>Access a shared public catalog to import books, or contribute books directly to the community catalog.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Card */}
        <div className={styles.card}>
          <div className={styles.cardHeaderMobileOnly}>
            <div className={styles.brandRowMobile}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192-removebg.png" alt="" width={40} height={40} className={styles.brandLogoMobile} />
              <div>
                <div className={styles.brandMobile}>Colophon</div>
                <div className={styles.taglineMobile}>Your library, read aloud</div>
              </div>
            </div>
            <div className={styles.mobileFeaturesTagline}>
              <span>✨ AI Summaries</span>
              <span>🎙️ Premium Voices</span>
              <span>🎴 3D Flashcards</span>
            </div>
          </div>

          <h2 className={styles.cardTitle}>{mode === "login" ? "Sign In" : "Create Account"}</h2>
          {mode === "login" && (
            <p className={styles.cardSubtitle}>Access your personal library shelves.</p>
          )}

          <form onSubmit={handleSubmit}>
            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.field}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <div className={styles.passwordContainer}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.togglePassword}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
            </button>

            {mode === "login" && (
              <button
                type="button"
                className={styles.guestButton}
                onClick={handleGuestLogin}
                disabled={loading}
              >
                {loading ? "Logging in..." : "Continue as Guest"}
              </button>
            )}
          </form>

          <div className={styles.switch}>
            {mode === "login" ? (
              <>No account yet? <Link href="/signup">Sign up</Link></>
            ) : (
              <>Already have an account? <Link href="/login">Log in</Link></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
