import { publicMetadata } from "@/lib/marketing/metadata";
import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";
import { MarketingShell, PageIntro } from "@/components/marketing/site-shell";

export const metadata: Metadata = publicMetadata(
  "Contact BrostCo",
  "Send a message to the BrostCo team about the product, your account, privacy, or security. No account is required.",
  "/contact",
);

export default function ContactPage() {
  return (
    <MarketingShell>
      <PageIntro
        path="/contact"
        eyebrow="Contact"
        title="Tell us what you need."
        copy="Questions about the product, an account, privacy, or security. We read every message. No account is required."
      />
      <section className="bco-container bco-section">
        <ContactForm />
      </section>
    </MarketingShell>
  );
}
