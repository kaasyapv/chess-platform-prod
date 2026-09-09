import { requireProfile } from "@/lib/auth";
import { PgnViewer } from "./pgn-viewer";

export default async function PgnPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string; id: string }>;
}) {
  const { role, academyId, id } = await params;
  await requireProfile(role, academyId);

  return <PgnViewer academyId={academyId} role={role} pgnId={id} />;
}
