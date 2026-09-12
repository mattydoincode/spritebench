import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpriteBench",
  description: "Pixel art generation and composition pipeline"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
