// Bundled into ui/vendor/nostr.js (window.NostrTools) by .github/workflows/vendor.yml — nostr-tools (MIT) by fiatjaf & contributors.
export { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
export * as nip19 from 'nostr-tools/nip19';
export * as nip17 from 'nostr-tools/nip17';
export * as nip44 from 'nostr-tools/nip44';
export * as nip59 from 'nostr-tools/nip59';
export const bytesToHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const hexToBytes = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
