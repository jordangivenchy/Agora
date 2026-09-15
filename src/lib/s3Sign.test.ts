import { describe, expect, it } from "vitest";
import { canonicalPath, signS3Request } from "./s3Sign";

describe("S3 request signing", () => {
  it("matches AWS's worked PUT Object example", () => {
    /* docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html */
    const h = signS3Request({
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      body: "Welcome to Amazon S3.",
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h["x-amz-content-sha256"]).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    );
  });

  it("encodes a path the way S3 does", () => {
    expect(canonicalPath("/test$file.text")).toBe("/test%24file.text");
    expect(canonicalPath("/agora-hls/d065f134-b85b-4424-81f2-97812a0e85ee/replay.m3u8")).toBe("/agora-hls/d065f134-b85b-4424-81f2-97812a0e85ee/replay.m3u8");
    expect(canonicalPath("/a%20b/c d")).toBe("/a%20b/c%20d");
  });
});
