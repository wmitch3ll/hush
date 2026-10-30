// Sanity test for the vendored bundle: a NIP-17 message wraps for Bob and only Bob can unwrap it.
import fs from 'fs'; import vm from 'vm';
const ctx = { window: {}, crypto: globalThis.crypto, TextEncoder, TextDecoder, console };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const N = ctx.window.NostrTools || ctx.NostrTools; if (!N) throw new Error('NostrTools missing');
const a = N.generateSecretKey(), b = N.generateSecretKey(), c = N.generateSecretKey();
const wrap = N.nip17.wrapEvent(a, { publicKey: N.getPublicKey(b) }, 'hello hush');
if (wrap.kind !== 1059) throw new Error('kind ' + wrap.kind);
if (wrap.pubkey === N.getPublicKey(a)) throw new Error('sender visible');
const r = N.nip59.unwrapEvent(wrap, b);
if (r.content !== 'hello hush' || r.pubkey !== N.getPublicKey(a) || r.kind !== 14) throw new Error('bad rumor ' + JSON.stringify(r));
let failed = false; try { N.nip59.unwrapEvent(wrap, c); } catch (e) { failed = true; } if (!failed) throw new Error('stranger could unwrap');
console.log('nostr bundle ok', N.nip19.npubEncode(N.getPublicKey(a)).slice(0, 12));
