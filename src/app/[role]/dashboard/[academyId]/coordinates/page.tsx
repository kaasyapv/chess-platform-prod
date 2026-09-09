import { requireProfile } from "@/lib/auth";
import { CoordinatesClient } from "./coordinates-client";

export default async function CoordinatesPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  await requireProfile(role, academyId);
  return <CoordinatesClient />;
}
