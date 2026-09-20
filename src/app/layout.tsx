import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { BottomNav, TopNav } from "@/components/nav";

export const metadata: Metadata = {
  title: "API Sentinel — Your API changed. Your docs shouldn't fall behind.",
  description:
    "AI-powered API change intelligence and documentation synchronization. Phone-first edition.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#070b12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <Suspense fallback={null}>
          <TopNav />
        </Suspense>
        <main id="main">{children}</main>
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
