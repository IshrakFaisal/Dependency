import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-28 text-center">
      <FileQuestion className="mx-auto mb-6 size-12 text-[#91edbe]" />
      <p className="eyebrow">404 / NOT FOUND</p>
      <h1 className="mt-4 text-3xl font-semibold">This analysis isn’t here.</h1>
      <p className="muted my-5">
        This analysis may not exist on this server or its mode is disabled.
        Start a new comparison or explore the synthetic demo.
      </p>
      <Button asChild>
        <Link href="/">
          <ArrowLeft />
          Back to overview
        </Link>
      </Button>
    </div>
  );
}
