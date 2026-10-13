import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/LegalPage";
import { LEGAL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms for using YouBank (draft, to be reviewed by counsel).", alternates: { canonical: LEGAL.terms } };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="5 October 2026"
      intro={<p>These terms are an agreement between you and [company legal name] (&quot;YouBank&quot;, &quot;we&quot;) for the use of YouBank. By creating an account or paying for a plan you agree to them.</p>}
      sections={[
        { heading: "Your account", body: <><p>You sign in with a Google account and are responsible for what happens under your account. Keep your sign-in secure and tell us at once if you think someone else has used it.</p><p>Campus is for students with a current .edu address; we may move an account to Free when the address no longer qualifies.</p></> },
        { heading: "Plans, seats and payment", body: <><p>Paid plans are billed in advance, monthly or yearly, in US dollars, through our payment processor, Stripe. Prices exclude tax unless shown; where we must collect tax, it is added at checkout. Plans renew automatically until cancelled.</p><p>Deal Team and Enterprise are sold per seat. The buyer may give seats to members of their team; each seat is for one named person and may not be shared.</p><p>Upgrades and added seats are charged pro rata at once. Downgrades, removed seats and cancellations take effect at the end of the paid period. If a payment fails we will retry it and may pause paid features until it succeeds.</p></> },
        { heading: "AI allowances and credit packs", body: <><p>Each plan includes an AI allowance measured in US dollars of model use at the AI providers&apos; list prices, per day and per allowance month. AI credit packs are one-time purchases that add AI use after the allowance is used; they do not expire, cannot be transferred or exchanged for cash, and end if your account is closed. See the <Link href="/pricing" className="underline">pricing page</Link>.</p><p>We may set or change fair-use limits to keep the service available to everyone, and will tell you before any change that reduces what a paid plan includes.</p></> },
        { heading: "Refunds", body: <p>Refunds are described in the <Link href={LEGAL.refunds} className="underline">Refund Policy</Link>.</p> },
        { heading: "Acceptable use", body: <p>Do not use YouBank to break the law, to send spam or unlawful marketing, to infringe anyone&apos;s rights, to probe or disrupt the service, or to resell it without our agreement. Email you send through YouBank goes from your own mailbox and is your responsibility, including consent and opt-outs.</p> },
        { heading: "Not investment advice", body: <p>YouBank provides data, analysis and drafting tools. Nothing in it is investment, legal, tax or accounting advice. Figures are derived from public filings and third-party sources and may be wrong, late or restated; check anything you rely on.</p> },
        { heading: "Your content and data", body: <p>You keep the rights to what you upload or create. You give us the permissions needed to run the service for you. How we handle personal data is described in the <Link href={LEGAL.privacy} className="underline">Privacy Policy</Link>. Your data does not train any AI model.</p> },
        { heading: "Changes, suspension and ending", body: <p>You may cancel at any time. We may suspend or end accounts that break these terms. We may change these terms; for material changes we will give notice before they apply to a paid plan.</p> },
        { heading: "Liability", body: <p>[To be completed by counsel: warranties disclaimer, limitation of liability, indemnity, governing law and venue, and how to contact us.]</p> },
      ]}
    />
  );
}
