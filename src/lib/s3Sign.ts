/* AWS Signature Version 4 for one S3 request with its whole body in hand
   — enough to put a small object into the recordings bucket (Cloudflare
   R2 speaks S3) without an SDK. Checked against AWS's own worked example
   in s3Sign.test.ts. Server-only (node:crypto). */

import { createHash, createHmac } from "node:crypto";

const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** A path as S3 canonicalises it: every byte but the unreserved set
    percent-encoded, slashes kept. */
export function canonicalPath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** Headers for the request, Authorization included. `host` is in the
    result for completeness; fetch sets it from the URL itself. */
export function signS3Request(opts: {
  method: string;
  url: string;
  body: string;
  headers?: Record<string, string>;
  accessKey: string;
  secret: string;
  region: string;
  now?: Date;
}): Record<string, string> {
  const url = new URL(opts.url);
  const amzDate = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = amzDate.slice(0, 8);
  const payload = sha256Hex(opts.body);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = url.host;
  headers["x-amz-content-sha256"] = payload;
  headers["x-amz-date"] = amzDate;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [opts.method, canonicalPath(url.pathname), query, canonicalHeaders, signedHeaders, payload].join("\n");
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${opts.secret}`, day), opts.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`,
  };
}
