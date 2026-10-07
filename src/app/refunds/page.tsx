import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";
import { LEGAL } from "@/lib/site";

export const metadata: Metadata = { title: "Refund Policy", description: "Cancellations and refunds for YouBank plans and AI credit packs (draft, to be reviewed by counsel).", alternates: { canonical: LEGAL.refunds } };

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="5 October 2026"
      intro={<p>How cancellations and refunds work for YouBank plans and AI credit packs. Where the law where you live gives you more, that applies instead.</p>}
      sections={[
        { heading: "Cancelling a plan", body: <p>Cancel at any time in Settings, under Plan, then Manage billing. Your plan stays on until the end of the period you have paid for, and the plan page shows the date; nothing more is charged after it. We do not refund the unused part of a period, except as below.</p> },
        { heading: "Changing plan or seats", body: <p>Upgrades and added seats are charged pro rata for the rest of the period. Downgrades and removed seats take effect at the end of the period, so you keep what you paid for until then.</p> },
        { heading: "AI credit packs", body: <p>An unused credit pack can be refunded in full within 14 days of purchase: write to us from the email on your account. A refund removes that pack&apos;s credits. Credits that have been used cannot be refunded.</p> },
        { heading: "Duplicate and mistaken charges", body: <p>If you are charged twice for the same plan, the second subscription is cancelled and refunded automatically. For any other charge you believe is a mistake, write to us within 60 days and we will look into it.</p> },
        { heading: "How refunds are paid", body: <p>To the card or account that paid, through Stripe. They usually appear within 5 to 10 business days, depending on your bank. Receipts and invoices are in Settings, under Plan.</p> },
        { heading: "Contact", body: <p>[Support address to be added.] Please include the email on your account and, if you have it, the receipt or invoice number. See also the <Link href={LEGAL.terms} className="underline">Terms of Service</Link>.</p> },
      ]}
    />
  );
}
