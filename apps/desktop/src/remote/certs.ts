import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import forge from "node-forge";

/**
 * Phones only allow camera access on HTTPS pages. We create a local root CA once
 * (the user installs it on an iPhone once) and issue a server certificate for the
 * computer's current LAN addresses, re-issued whenever they change.
 */

export const CA_NAME = "Gepetta Studio Local CA";

export interface Pem {
  cert: string;
  key: string;
}

function serial(): string {
  // Positive 16-byte serial number.
  return "01" + forge.util.bytesToHex(forge.random.getBytesSync(15));
}

function generateKeys(): Promise<forge.pki.rsa.KeyPair> {
  return new Promise((resolve, reject) =>
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keys) => (err ? reject(err) : resolve(keys))),
  );
}

async function createCA(): Promise<Pem> {
  const keys = await generateKeys();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600_000);
  const attrs = [
    { name: "commonName", value: CA_NAME },
    { name: "organizationName", value: "Gepetta Studio" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

export async function issueServerCert(ca: Pem, hosts: string[]): Promise<Pem> {
  const caCert = forge.pki.certificateFromPem(ca.cert);
  const caKey = forge.pki.privateKeyFromPem(ca.key);
  const keys = await generateKeys();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600_000);
  // Apple rejects server certificates valid for more than 825 days.
  cert.validity.notAfter = new Date(Date.now() + 800 * 24 * 3600_000);
  cert.setSubject([{ name: "commonName", value: hosts[0] ?? "localhost" }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? { type: 7, ip: h } : { type: 2, value: h })),
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

/** DER bytes of a PEM certificate, the format phones install from a download. */
export function certToDer(pem: string): Buffer {
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes(), "binary");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Loads (or creates) the CA and a server certificate covering exactly `hosts`. */
export async function loadCertificates(dir: string, hosts: string[]): Promise<{ ca: Pem; server: Pem }> {
  await mkdir(dir, { recursive: true });
  const caFile = path.join(dir, "ca.json");
  const serverFile = path.join(dir, "server.json");
  let ca = await readJson<Pem>(caFile);
  if (!ca) {
    ca = await createCA();
    await writeFile(caFile, JSON.stringify(ca), { mode: 0o600 });
  }
  const cached = await readJson<Pem & { hosts: string[]; ca: string }>(serverFile);
  const key = [...hosts].sort().join(",");
  const stillValid =
    cached && cached.ca === ca.cert && [...cached.hosts].sort().join(",") === key &&
    forge.pki.certificateFromPem(cached.cert).validity.notAfter.getTime() > Date.now() + 7 * 24 * 3600_000;
  if (stillValid) return { ca, server: cached };
  const server = await issueServerCert(ca, hosts);
  await writeFile(serverFile, JSON.stringify({ ...server, hosts, ca: ca.cert }), { mode: 0o600 });
  return { ca, server };
}
