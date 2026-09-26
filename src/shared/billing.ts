/**
 * Which key a generation bills, given the owner's keys for one provider.
 *
 * In order: the project's pick for that provider, then the owner's account
 * default, then the only key if there is just one. Several keys and no
 * default is a refusal, not a guess -- billing the wrong key is worse than
 * asking. Shared so the studio can say why Generate is blocked before the
 * server would.
 */

export interface BillableKey {
  id: string;
  provider: string;
  isDefault: boolean;
}

/** Provider id → key id, set per project by its owner. */
export type KeyDefaults = Record<string, string>;

export type BillingChoice =
  | { ok: true; keyId: string; via: "project" | "account" | "only" }
  | { ok: false; reason: "no-key" | "no-default" };

export function chooseBillingKey(
  provider: string,
  keys: readonly BillableKey[],
  projectDefaults: KeyDefaults
): BillingChoice {
  const options = keys.filter((key) => key.provider === provider);

  const picked = projectDefaults[provider];
  if (picked && options.some((key) => key.id === picked)) {
    return { ok: true, keyId: picked, via: "project" };
  }

  const fallback = options.find((key) => key.isDefault);
  if (fallback) return { ok: true, keyId: fallback.id, via: "account" };

  if (options.length === 1) return { ok: true, keyId: options[0].id, via: "only" };

  return { ok: false, reason: options.length === 0 ? "no-key" : "no-default" };
}
