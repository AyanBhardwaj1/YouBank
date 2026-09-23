import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { requireSession } from "@/lib/collab/db";
import { toolById } from "@/lib/workflows/registry";
import { ToolRunner } from "@/components/workflows/ToolRunner";
import type { Inputs } from "@/lib/workflows/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared session" };

/**
 * A shared working session.
 *
 * The session's current state is handed to the runner as its initial inputs, so someone joining
 * late sees the model as it stands rather than an empty form.
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) redirect("/app/collab");

  let session;
  try { session = await requireSession(user, id); }
  catch (e) {
    return (
      <Shell>
        <p className="text-[12px] text-neg">{e instanceof Error ? e.message : "You cannot open that session."}</p>
      </Shell>
    );
  }

  const tool = session.refId ? toolById(session.refId) : undefined;
  if (!tool) {
    return (
      <Shell>
        <h1 className="text-[16px] font-semibold">{session.title}</h1>
        <p className="mt-2 text-[12px] text-muted">
          This session points at a tool that no longer exists{session.refId ? ` (${session.refId})` : ""}.
        </p>
      </Shell>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{session.title}</h1>
            <p className="text-[11px] text-muted">Shared session · anyone here edits the same inputs</p>
          </div>
          <Link href="/app/collab" className="shrink-0 text-[11.5px] text-muted hover:text-fg">← All sessions</Link>
        </div>
        <ToolRunner
          tool={tool}
          initialInputs={session.state as Inputs}
          sessionId={session.id}
          me={{ id: user.id, name: user.name || user.email }}
        />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[760px] px-5 py-10">
        <div className="ctl border border-line bg-elevated/40 p-5">
          {children}
          <Link href="/app/collab" className="mt-4 inline-block text-[12px] text-accent hover:underline">Back to sessions</Link>
        </div>
      </div>
    </div>
  );
}
