import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Colophon Reader",
    short_name: "Colophon",
    description: "A premium and modern epub book reader.",
    start_url: "/library",
    display: "standalone",
    background_color: "#152540",
    theme_color: "#152540",
    icons: [
      {
        src: "/logo.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/logo.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/logo.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
