"use client";

import { useEffect, useState } from "react";
import styles from "./InstallPrompt.module.css";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if already running in standalone mode
    const isStandalone = 
      window.matchMedia("(display-mode: standalone)").matches || 
      (navigator as any).standalone === true;

    if (isStandalone) return;

    // Check if user dismissed it recently
    const isDismissed = sessionStorage.getItem("colophon_install_dismissed") === "true";
    if (isDismissed) return;

    // Detect mobile or tablet device
    const isMobileOrTablet = 
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
      window.innerWidth <= 1024;

    if (!isMobileOrTablet) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the default browser mini-infobar prompt
      e.preventDefault();
      // Store the event so we can trigger it later
      setDeferredPrompt(e);
      // Show our custom banner
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Hide prompt once app is installed
    const handleAppInstalled = () => {
      setIsVisible(false);
      setDeferredPrompt(null);
      console.log("Colophon app was installed successfully.");
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the browser install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);

    // We no longer need the prompt event
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  const handleDismissClick = () => {
    // Hide the banner and store dismissal state
    setIsVisible(false);
    sessionStorage.setItem("colophon_install_dismissed", "true");
  };

  if (!isVisible || !deferredPrompt) return null;

  return (
    <div className={styles.promptBanner}>
      <div className={styles.content}>
        <div className={styles.icon}>📖</div>
        <div className={styles.textContainer}>
          <h4 className={styles.title}>Install Colophon</h4>
          <p className={styles.desc}>Install Colophon Reader on your phone for a full standalone reading experience.</p>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.dismissBtn} onClick={handleDismissClick}>
          Not Now
        </button>
        <button className={styles.installBtn} onClick={handleInstallClick}>
          Install App
        </button>
      </div>
    </div>
  );
}
