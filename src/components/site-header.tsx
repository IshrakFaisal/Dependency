"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function SiteHeader({
  demoMode,
  staticEnabled = false,
}: {
  demoMode: boolean;
  staticEnabled?: boolean;
}) {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="mx-auto flex min-h-[76px] max-w-[1288px] flex-wrap items-center justify-between gap-4 px-6 py-4 lg:px-8">
        <Link
          href="/"
          aria-label="DependencyGuard home"
          className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.6px] sm:text-[19px]"
        >
          <span className="brand-mark">
            <ShieldCheck size={22} strokeWidth={1.8} />
          </span>
          Dependency
          <span className="-ml-2.5 font-normal text-[#b6c2ba]">Guard</span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="order-3 flex w-full items-center justify-center gap-7 text-[13px] sm:order-none sm:w-auto"
        >
          <Link
            className={cn("nav-link", pathname === "/" && "active")}
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
          >
            Overview
          </Link>
          {demoMode && (
            <Link
              className={cn(
                "nav-link",
                pathname.startsWith("/report") && "active",
              )}
              href="/report/demo-example-utils"
              aria-current={pathname.startsWith("/report") ? "page" : undefined}
            >
              Demo report <ArrowUpRight size={12} />
            </Link>
          )}
          <Link className="nav-link" href="/#how-it-works">
            How it works
          </Link>
        </nav>
        <span className="mode-chip">
          <span
            className={cn(
              "size-1.5 rounded-full",
              staticEnabled || demoMode ? "bg-[#9deaab]" : "bg-amber-300",
            )}
          />
          {staticEnabled
            ? "Static analysis"
            : demoMode
              ? "Demo mode"
              : "Analysis disabled"}
          <span className="ml-1 hidden border-l border-white/15 pl-2 text-[#7d8a82] sm:inline">
            v0.4
          </span>
        </span>
      </div>
    </header>
  );
}
