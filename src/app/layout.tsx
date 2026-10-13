import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { demoMode, staticAnalysisEnabled } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DependencyGuard — Know what changed",
    template: "%s | DependencyGuard",
  },
  description:
    "Know what changed before you trust the update. Compare npm archives and investigate evidence-backed static changes without running package code.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader demoMode={demoMode} staticEnabled={staticAnalysisEnabled} />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
