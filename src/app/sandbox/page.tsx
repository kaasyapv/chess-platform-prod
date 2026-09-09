/* Internal UI sandbox - isolated proving ground for components before they
 * are integrated into the core app (board frame symmetry, premium avatar art,
 * gamified board pipeline). Not linked from anywhere; visit /sandbox. */

import type { Metadata } from "next";
import { SymmetricBoard } from "@/components/sandbox/SymmetricBoard";
import { GamifiedPipeline } from "@/components/sandbox/GamifiedPipeline";
import { AvatarRigPreview } from "@/components/sandbox/AvatarRigPreview";

export const metadata: Metadata = { title: "UI Sandbox", robots: { index: false } };

export default function SandboxPage() {
  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-12">
      <section>
        <h2 className="text-lg font-semibold mb-4">1 · Symmetric board frame</h2>
        <div className="flex flex-wrap items-end gap-8">
          <SymmetricBoard size={420} />
          <SymmetricBoard size={219} />
          <SymmetricBoard size={121} frameWidth={3} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">2 · Avatar cast (click to greet)</h2>
        <AvatarRigPreview />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">3 · Gamified board pipeline</h2>
        <GamifiedPipeline />
      </section>
    </main>
  );
}
