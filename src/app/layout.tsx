import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BorderPulse · Dispatch Console",
  description: "Cross-border dispatch decision demo for Otay Mesa and Tecate, built on simulated data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
