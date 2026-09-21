import Link from "next/link";
import { notFound } from "next/navigation";
import { ROLES, ROLE_IDS, type RoleId } from "@/lib/roles";
import { toolsForRole } from "@/lib/workflows/registry";
import { RolePage } from "@/components/marketing/RolePage";

export const dynamic = "force-static";

export function generateStaticParams() {
  return ROLE_IDS.map((role) => ({ role }));
}

export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const r = ROLES[role as RoleId];
  return r ? { title: `For ${r.label.toLowerCase()}s`, description: r.pitch.slice(0, 180) } : { title: "Roles" };
}

export default async function ForRole({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!ROLE_IDS.includes(role as RoleId)) notFound();
  const id = role as RoleId;
  const tools = toolsForRole(id).map((t) => ({ id: t.id, title: t.title, tagline: t.tagline, kind: t.kind, category: t.category, icon: t.icon, specialties: t.specialties ?? null, savesMinutes: t.savesMinutes ?? null }));
  return (
    <>
      <RolePage role={id} tools={tools} />
      <div className="sr-only"><Link href="/">Home</Link></div>
    </>
  );
}
