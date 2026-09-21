import { Terminal } from "@/components/terminal/Terminal";

export const metadata = { title: "Terminal" };

export default async function TerminalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const initial = s("ticker") || s("fn") ? { ticker: s("ticker")?.toUpperCase(), fn: s("fn"), arg: s("arg") } : undefined;
  return <Terminal initial={initial} />;
}
