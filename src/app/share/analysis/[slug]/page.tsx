import { createClient } from "@/lib/supabase/server";
import { ShareAnalysisClient } from "./share-client";

/** Shared analysis view. Readable by signed-in members of the same academy
 *  (RLS analyses_academy_read) - assumption noted in docs/PLAN.md: research
 *  showed "Save & share" without specifying public/anonymous access. */
export default async function ShareAnalysisPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("analyses")
    .select("title, description, pgn, annotations, created_at")
    .eq("share_slug", slug)
    .single();

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Analysis not found</h1>
          <p className="text-muted-foreground">This link may be invalid, or you may need to sign in with an account from the same academy.</p>
        </div>
      </main>
    );
  }
  return <ShareAnalysisClient analysis={data} />;
}
