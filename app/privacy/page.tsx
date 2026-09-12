import Link from "next/link";
import { LegalPage } from "@/client/components/LegalPage";

export const metadata = { title: "Privacy — SpriteBench" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="September 2026">
      <h2>What we collect</h2>
      <p>
        When you sign in with Google we receive and store your name, email address
        and profile picture URL. That is the whole of the Google data we ask for —
        we request only the basic identity scopes, so we have no access to your
        Gmail, Drive, Calendar or contacts.
      </p>
      <p>
        We also store what you make: projects, the prompts you write, generated and
        uploaded images, palettes, templates, and a record of each generation
        request and its cost.
      </p>

      <h2>Image model keys</h2>
      <p>
        Keys you add are encrypted before they are written to our database, and
        after you save one we only ever display its last few characters. A key is
        sent to its provider to fulfil your generation requests and is used for
        nothing else. If you share a project, a collaborator you allow to generate
        bills your key without being able to read it.
      </p>

      <h2>What we send elsewhere</h2>
      <p>
        Prompts and reference images you generate with are sent to the image
        provider whose key you supplied, and are then subject to that
        provider&apos;s own terms and privacy policy. Images are stored in
        Cloudflare R2. Nothing you make is used to train a model by us nor
        will we ever use images or content you generate for purposes other
        than providing the service to you.
      </p>

      <h2>Sharing</h2>
      <p>
        A project is private to you until you invite someone. People you invite can
        see everything in that project. We do not sell personal data, and we do not
        share it with third parties except the infrastructure providers above that
        are needed to run the service.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Deleting a project removes it and its art from your account. To delete your
        account entirely, email the address below and we will remove your user
        record, your keys and your projects.
      </p>

      <h2>Contact</h2>
      <p>
        Reach out with any questions, concerns, or feedback to <a href="mailto:spritebench@gmail.com">spritebench@gmail.com</a>.
      </p>
      <p>
        Read our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
