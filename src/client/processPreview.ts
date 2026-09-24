export const PROCESS_DEBOUNCE_MS = 80;

export function previewAfterKeyChange<T>(options: {
  previous: T | null;
  nextPeek: T | null;
  assetChanged: boolean;
}): { preview: T | null; loading: boolean } {
  if (options.nextPeek) return { preview: options.nextPeek, loading: false };
  if (options.assetChanged) return { preview: null, loading: true };
  return { preview: options.previous, loading: true };
}

export function framesAfterSignatureChange<T>(
  previous: Array<T | null>,
  peeked: Array<T | null>
): Array<T | null> {
  return peeked.map((frame, index) => frame ?? previous[index] ?? null);
}

export function keysToCancel(previousKeys: string[], nextKeys: string[]): string[] {
  const keep = new Set(nextKeys);
  return previousKeys.filter((key) => !keep.has(key));
}

export function shouldDebounceProcess(hasLastGood: boolean): boolean {
  return hasLastGood;
}
