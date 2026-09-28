import type { Metadata } from "next";
import "./globals.css";

const TITLE = "SpriteBench: prototype with AI, ship with artists";
const DESCRIPTION =
  "Prototype game art with AI, then hand it to an artist and sync it into Godot. Bring your own OpenAI or Gemini key.";

export const metadata: Metadata = {
  // Link previews need absolute image URLs. Without a base, Next builds them
  // from localhost, and every shared link would show a broken card.
  metadataBase: new URL(process.env.AUTH_URL?.trim() || "https://spritebench.com"),
  title: TITLE,
  description: DESCRIPTION,
  // The images themselves are app/opengraph-image.png and app/twitter-image.png.
  openGraph: {
    type: "website",
    siteName: "SpriteBench",
    title: TITLE,
    description: DESCRIPTION
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
