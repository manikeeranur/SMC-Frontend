import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nifty Options Terminal",
  description: "Nifty 50 Options — 9:26 AM Scanner | Chain | Watchlist",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
