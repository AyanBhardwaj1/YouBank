import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { LEGAL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", description: "How YouBank handles personal data (draft, to be reviewed by counsel).", alternates: { canonical: LEGAL.privacy } };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="5 October 2026"
      intro={<p>This policy explains what personal data [company legal name] (&quot;YouBank&quot;) collects, why, and the choices you have.</p>}
      sections={[
        { heading: "What we collect", body: <><p>Account data from your Google sign-in (name, email address). What you put into YouBank: your profile and preferences, documents, models, notes and messages. If you connect a mailbox, the email the relationships agent reads and the drafts it writes. Usage records, including AI usage and its cost, to run allowances and billing.</p><p>Payment details are collected and held by Stripe, our payment processor; we see only the card brand, its last four digits, your billing address and tax ID.</p></> },
        { heading: "How we use it", body: <p>To provide the service you asked for, to bill you, to keep the service secure and working, and to tell you about changes to it. Your data does not train any AI model, ours or a provider&apos;s.</p> },
        { heading: "Who processes it", body: <p>Service providers that run parts of YouBank for us, under contract: hosting (Vercel), the database (Neon), file storage (Cloudflare), payments and tax (Stripe), and the AI providers that answer your requests (OpenAI, Anthropic and others named in the app). [To be completed by counsel: the full list, transfers outside your country and the safeguards used.]</p> },
        { heading: "How long we keep it", body: <p>While your account is open, and afterwards only as long as the law requires (invoices and tax records, for example). You can delete documents, disconnect mailboxes and close your account at any time.</p> },
        { heading: "Your rights", body: <p>You may ask for a copy of your data, to correct it, to delete it, or to object to how we use it. [To be completed by counsel: the rights that apply where you live, how to make a request, and how to complain to a regulator.]</p> },
        { heading: "Cookies", body: <p>We use cookies only to keep you signed in and remember your settings, such as your theme. We do not use advertising cookies.</p> },
        { heading: "Contact", body: <p>[Support and privacy contact address to be added.]</p> },
      ]}
    />
  );
}
