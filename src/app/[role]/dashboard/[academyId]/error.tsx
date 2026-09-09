"use client";

/* Catches anything a dashboard page throws so the screen never goes blank.
 * Next.js renders this in place of the page and keeps the app shell around. */

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function DashboardError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("dashboard page failed:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <h1 className="text-xl font-semibold">This page could not load</h1>
      <p className="text-muted-foreground max-w-md">
        Something went wrong while loading your data. Nothing was lost. Try again, or move to
        another page and come back.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground font-mono">Reference: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  );
}
