import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION =
  "Generate, clean up and organize game sprites with AI, using your own OpenAI or Gemini key.";

export const metadata: Metadata = {
  // Link previews need absolute image URLs. Without a base, Next builds them
  // from localhost, and every shared link would show a broken card.
  metadataBase: new URL(process.env.AUTH_URL?.trim() || "https://spritebench.com"),
  title: "SpriteBench",
  description: DESCRIPTION,
  // The images themselves are app/opengraph-image.png and app/twitter-image.png.
  openGraph: {
    type: "website",
    siteName: "SpriteBench",
    title: "SpriteBench",
    description: DESCRIPTION
  },
  twitter: {
    card: "summary_large_image",
    title: "SpriteBench",
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
