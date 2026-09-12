import Link from "next/link";
import { LegalPage } from "@/client/components/LegalPage";

export const metadata = { title: "Terms — SpriteBench" };

/**
 * Required for Google brand verification alongside the privacy policy. Draft
 * copy -- accurate about how the service works, not lawyer-reviewed.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 2026">
      <h2>The service</h2>
      <p>
        SpriteBench is a tool for generating and processing game art. It is
        provided free of charge and as-is, with no uptime guarantee. We may change
        or discontinue it, and we will make a reasonable effort to give notice
        before doing anything that would lose your work.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for what happens under your
        account, including anything done by collaborators you invite to your
        projects.
      </p>

      <h2>Generation and cost</h2>
      <p>
        Generation runs against an image model key you supply, and every request
        bills your account with that provider directly. You are responsible for
        those charges, including charges incurred by collaborators you have granted
        permission to generate on your projects. You must comply with the terms and
        usage policies of whichever provider you use.
      </p>

      <h2>Your content</h2>
      <p>
        You keep whatever rights you have in the art you make here. You grant us
        only the permission needed to store it and show it back to you and to the
        people you share it with. Do not use the service to produce material that
        is illegal, or that infringes someone else&apos;s rights.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for lost work, provider
        charges, or any indirect or consequential damages arising from your use of
        the service. Keep your own copies of art that matters to you.
      </p>
      <p>
        Read our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
