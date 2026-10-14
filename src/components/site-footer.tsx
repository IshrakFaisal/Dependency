import { ShieldCheck } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-[1288px] flex-col justify-between gap-3 px-6 py-7 text-xs text-[#78867e] sm:flex-row lg:px-8">
        <span className="flex items-center gap-2">
          <ShieldCheck size={15} />
          DependencyGuard{" "}
          <span className="ml-2 text-[#526158]">
            A little less blind trust.
          </span>
        </span>
        <span className="mono text-[10px]">
          EVIDENCE FIRST. EXECUTION STAYS ISOLATED.{" "}
          <span className="ml-3 text-[#a0b3a6]">PHASE 03</span>
        </span>
      </div>
    </footer>
  );
}
