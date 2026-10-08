import type { Metadata, Viewport } from "next";
import { Fraunces, Literata, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Colophon",
  description: "A personal EPUB reader with AI read-aloud.",
  applicationName: "Colophon",
  // iOS home-screen app: launches standalone, with the navy page showing
  // through a translucent status bar (content is kept clear via safe-area
  // insets in globals.css).
  appleWebApp: {
    capable: true,
    title: "Colophon",
    statusBarStyle: "black-translucent",
  },
  // Stop iOS Safari turning numbers in book text into phone-number links.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#152540",
};

import { PwaRegister } from "@/components/PwaRegister";
import { InstallPrompt } from "@/components/Pwa/InstallPrompt";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${literata.variable} ${plexMono.variable}`}>
      <body>
        <PwaRegister />
        <InstallPrompt />
        {children}
      </body>
    </html>
  );
}
