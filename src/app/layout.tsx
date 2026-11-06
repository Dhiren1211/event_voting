import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Geometric sans for the whole UI — self-hosted by Next at build time.
const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "Nepal Grand Tihar Festival 2026 — Audience Voting",
  description:
    "Official audience choice voting for the Nepal Grand Tihar Festival 2026 talent show, organized by the Nepalese Community in Busan (NCB). One vote per device.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={montserrat.variable}>
      <body
        className="font-sans antialiased bg-background text-foreground"
      >
        {children}
        <Toaster position="top-center" closeButton />
      </body>
    </html>
  );
}
