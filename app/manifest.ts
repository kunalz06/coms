import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "COMMS",
    short_name: "COMMS",
    description: "Minimal messaging and calling for focused conversations.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f1",
    theme_color: "#3d6b53",
    orientation: "portrait",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon"
      }
    ]
  };
}
