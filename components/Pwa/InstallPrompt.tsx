"use client";

import { useEffect, useState } from "react";
import { isIOSDevice } from "@/lib/tts/iosAudio";
import { INSTALL_EVENT, isStandaloneApp, SHOW_INSTALL_HELP_EVENT } from "@/lib/pwa";
import styles from "./InstallPrompt.module.css";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// "native": Chromium's install dialog is available. "ios": explain Share >
// Add to Home Screen (iOS has no install API). "manual": other browsers.
type Variant = "native" | "ios" | "manual";

const DISMISSED_KEY = "colophon_install_dismissed";
const IOS_SHOW_DELAY_MS = 2500;

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function ShareIcon() {
  return (
    <svg className={styles.inlineIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function AddToHomeIcon() {
  return (
    <svg className={styles.inlineIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);

  useEffect(() => {
    if (isStandaloneApp()) return;

    const ios = isIOSDevice();
    const isMobileOrTablet =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      ios ||
      window.innerWidth <= 1024;
    const autoShow = isMobileOrTablet && !wasDismissed();

    let promptEvent: BeforeInstallPromptEvent | null = null;

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the default browser mini-infobar prompt and use our banner.
      e.preventDefault();
      promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      if (autoShow) setVariant("native");
    };

    const handleAppInstalled = () => {
      promptEvent = null;
      setVariant(null);
      setDeferredPrompt(null);
    };

    // Triggered by features that work best installed (e.g. Fullscreen on iPhone).
    const handleShowHelp = () => {
      setVariant(promptEvent ? "native" : ios ? "ios" : "manual");
    };

    // Explicit "Install" button (e.g. on the login page): go straight to the
    // native dialog when available. Runs synchronously inside the click, so
    // prompt() still has the user gesture it requires.
    const handleInstall = () => {
      if (!promptEvent) {
        handleShowHelp();
        return;
      }
      const event = promptEvent;
      promptEvent = null;
      setVariant(null);
      setDeferredPrompt(null);
      event.prompt().catch(() => {});
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener(SHOW_INSTALL_HELP_EVENT, handleShowHelp);
    window.addEventListener(INSTALL_EVENT, handleInstall);

    // iOS never fires beforeinstallprompt, so show the instructions ourselves.
    const iosTimer = ios && autoShow ? window.setTimeout(() => setVariant("ios"), IOS_SHOW_DELAY_MS) : undefined;

    return () => {
      window.clearTimeout(iosTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener(SHOW_INSTALL_HELP_EVENT, handleShowHelp);
      window.removeEventListener(INSTALL_EVENT, handleInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVariant(null);
  };

  const handleDismissClick = () => {
    setVariant(null);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Storage unavailable (e.g. locked-down private mode): just hide.
    }
  };

  if (!variant) return null;

  return (
    <div className={styles.promptBanner} role="dialog" aria-labelledby="install-title">
      <div className={styles.content}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" width={48} height={48} className={styles.icon} />
        <div className={styles.textContainer}>
          <h4 id="install-title" className={styles.title}>
            Install Colophon
          </h4>
          {variant === "ios" ? (
            <>
              <p className={styles.desc}>
                Add Colophon to your Home Screen to read full screen, like an app.
              </p>
              <ol className={styles.steps}>
                <li>
                  Tap <ShareIcon /> <strong>Share</strong> in the browser toolbar
                </li>
                <li>
                  Choose <AddToHomeIcon /> <strong>Add to Home Screen</strong>
                  <span className={styles.stepHint}> (scroll down if you don&apos;t see it)</span>
                </li>
                <li>
                  Tap <strong>Add</strong>
                </li>
              </ol>
            </>
          ) : variant === "manual" ? (
            <p className={styles.desc}>
              Use your browser menu and choose <strong>Install app</strong> or{" "}
              <strong>Add to Home Screen</strong> for a full-screen reading experience.
            </p>
          ) : (
            <p className={styles.desc}>
              Install Colophon Reader on your device for a full standalone reading experience.
            </p>
          )}
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.dismissBtn} onClick={handleDismissClick}>
          {variant === "native" ? "Not Now" : "Got it"}
        </button>
        {variant === "native" && (
          <button className={styles.installBtn} onClick={handleInstallClick}>
            Install App
          </button>
        )}
      </div>
    </div>
  );
}
