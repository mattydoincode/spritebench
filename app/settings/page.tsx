import { AccountSettings } from "@/client/components/AccountSettings";
import { PageShell } from "@/client/components/AppHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings & Keys — SpriteBench" };

export default function SettingsPage() {
  return (
    <PageShell active="settings">
      <AccountSettings />
    </PageShell>
  );
}
