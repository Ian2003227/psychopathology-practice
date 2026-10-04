// AES-GCM + PBKDF2 decryption of the encrypted question bank.
// The password never leaves the browser; data/bank.enc is public but useless without it.

const PBKDF2_ITER_FALLBACK = 250000;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

// envelope: { salt, iv, iterations, ciphertext } all base64 except iterations
async function decryptEnvelope(password, envelope) {
  const salt = b64ToBytes(envelope.salt);
  const iv = b64ToBytes(envelope.iv);
  const iterations = envelope.iterations || PBKDF2_ITER_FALLBACK;
  const ciphertext = b64ToBytes(envelope.ciphertext);
  const key = await deriveKey(password, salt, iterations);
  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch (e) {
    throw new Error("WRONG_PASSWORD");
  }
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text);
}

window.PsyCrypto = { decryptEnvelope };
