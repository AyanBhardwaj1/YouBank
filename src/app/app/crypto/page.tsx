import { CryptoWorkspace } from "@/components/crypto/CryptoWorkspace";

export const metadata = { title: "Crypto" };

export default async function CryptoPage({ searchParams }: { searchParams: Promise<{ tab?: string; token?: string }> }) {
  const { tab, token } = await searchParams;
  return <CryptoWorkspace initialTab={tab} initialToken={token?.slice(0, 60)} />;
}
