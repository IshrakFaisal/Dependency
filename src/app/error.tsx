"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-28 text-center">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1 className="my-4 text-3xl font-semibold">
        The page couldn’t be loaded.
      </h1>
      <p className="muted mb-6">
        No packages have been downloaded or executed.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
