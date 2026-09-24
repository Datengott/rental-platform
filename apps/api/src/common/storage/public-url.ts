// Turns a stored object reference into something a browser can load.
// LocalDiskObjectStorage hands back `local://<folder>/<file>`; main.ts serves
// ONLY the unit-photos folder at /media/unit-photos/ (KYC documents and
// complaint media stay private, on purpose). A real R2 backend would store
// an https URL already, which passes through untouched — so callers never
// need to know which storage is behind it.
export function toPublicMediaUrl(storageUrl: string, publicBase: string): string {
  const match = /^local:\/\/(.+)$/.exec(storageUrl);
  if (!match) return storageUrl;
  return `${publicBase.replace(/\/$/, '')}/media/${match[1]}`;
}
