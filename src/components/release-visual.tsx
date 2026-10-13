import {
  ArrowDown,
  ArrowRight,
  Box,
  Check,
  CircleDot,
  FileCode2,
  GitBranch,
  Globe2,
  ShieldCheck,
  Terminal,
} from "lucide-react";

export function ReleaseVisual() {
  return (
    <div
      className="release-visual"
      aria-label="Illustrative synthetic release comparison"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
        <span className="mono flex items-center gap-2 text-[10px] text-[#b2beb5]">
          <GitBranch size={13} /> RELEASE DIFF
        </span>
        <span className="mono text-[9px] text-[#79897f]">
          SYNTHETIC PREVIEW
        </span>
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5 text-[13px] font-medium">
          <Box size={17} className="text-[#9aaba0]" />
          example-utils
          <span className="ml-auto mono text-[10px] font-normal text-[#697b6f]">
            npm / package
          </span>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_35px_1fr] items-center">
          <div className="release-version">
            <span className="mono text-[9px] text-[#84b097]">
              TRUSTED RELEASE
            </span>
            <strong>
              v1.4.1
              <ShieldCheck size={15} className="text-[#89bd9a]" />
            </strong>
            <span className="text-[10px] text-[#6e8175]">
              Your starting point
            </span>
          </div>
          <ArrowRight size={15} className="mx-auto text-[#66796e]" />
          <div className="release-version candidate">
            <span className="mono text-[9px] text-[#b5aa7e]">
              CANDIDATE RELEASE
            </span>
            <strong>
              v1.4.2
              <CircleDot size={14} className="text-[#d3c07f]" />
            </strong>
            <span className="text-[10px] text-[#8e8870]">What changed?</span>
          </div>
        </div>
        <div className="my-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <ArrowDown size={12} className="text-[#6c8071]" />
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
        <div className="space-y-1.5">
          {[
            {
              icon: Globe2,
              label: "Outbound network activity",
              value: "+2 requests",
            },
            {
              icon: FileCode2,
              label: "Sensitive environment reads",
              value: "+3 reads",
            },
            {
              icon: Terminal,
              label: "Child-process execution",
              value: "+1 process",
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="visual-diff-row">
              <Icon size={13} className="text-[#9bad9f]" />
              <span>{label}</span>
              <span className="mono ml-auto text-[9px] text-[#d7b986]">
                {value}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-[#a4b5a9]">
          <span className="flex size-4 items-center justify-center rounded-full bg-[#8be9b3]/10">
            <Check size={10} className="text-[#9ce3b6]" />
          </span>
          Same package. A different story.
          <span className="mono ml-auto text-[8px] text-[#657d6c]">
            EVIDENCE FIRST
          </span>
        </div>
      </div>
    </div>
  );
}
