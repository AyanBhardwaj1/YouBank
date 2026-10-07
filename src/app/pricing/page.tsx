import type { Metadata } from "next";
import { Pricing } from "@/components/marketing/Pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "YouBank plans: Free, Campus for students, Pro, Deal Team and Enterprise, with a monthly AI allowance on every plan and AI credit packs when you need more.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return <Pricing />;
}
