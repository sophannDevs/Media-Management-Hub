import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashAndPeek } from "@/lib/media/inspect";
import { checkUpload, extensionOf, sizeCapFor, sniffType } from "@/lib/media/sniff";

// SEC-05: what a file is comes from its bytes, not from the browser.

const pad = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  while (out.length < 64) out.push(0);
  return new Uint8Array(out);
};
const box = (brand: string) => pad([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0], "isommp42");

describe("sniffType", () => {
  it.each([
    ["JPEG", pad([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["PNG", pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    ["GIF", pad("GIF89a"), "image/gif"],
    ["WebP", pad("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp"],
    ["MP4 (isom)", box("isom"), "video/mp4"],
    ["MP4 (mp42)", box("mp42"), "video/mp4"],
    ["M4A", box("M4A "), "audio/mp4"],
    ["QuickTime", box("qt  "), "video/quicktime"],
    ["AVIF", box("avif"), "image/avif"],
    ["WebM", pad([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86, 0x81, 0x01], [0x42, 0x82, 0x84], "webm"), "video/webm"],
    ["Matroska", pad([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x88], "matroska"), "video/x-matroska"],
    ["AVI", pad("RIFF", [0, 0, 0, 0], "AVI LIST"), "video/x-msvideo"],
    ["WAV", pad("RIFF", [0, 0, 0, 0], "WAVEfmt "), "audio/wav"],
    ["MP3 (ID3)", pad("ID3", [3, 0]), "audio/mpeg"],
    ["MP3 (frame)", pad([0xff, 0xfb, 0x90, 0x64]), "audio/mpeg"],
    ["Ogg", pad("OggS"), "audio/ogg"],
    ["FLAC", pad("fLaC"), "audio/flac"],
    ["AAC", pad([0xff, 0xf1, 0x50, 0x80]), "audio/aac"],
  ])("recognises %s", (_name, bytes, mimeType) => {
    expect(sniffType(bytes)?.mimeType).toBe(mimeType);
  });

  it("recognises nothing in text, HTML, executables or too few bytes", () => {
    expect(sniffType(pad("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(pad("MZ", [0x90, 0x00, 0x03]))).toBeNull();
    expect(sniffType(pad("%PDF-1.7"))).toBeNull();
    expect(sniffType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffType(pad("RIFF", [0, 0, 0, 0], "ACON"))).toBeNull();
  });
});

describe("checkUpload", () => {
  const mp4 = box("isom");
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepts a file whose bytes, type and extension agree, and reports the real MIME type", () => {
    expect(checkUpload("VIDEO", "clip.MP4", mp4)).toEqual({ ok: true, mimeType: "video/mp4", kind: "video" });
    expect(checkUpload("IMAGE", "photo.png", png)).toEqual({ ok: true, mimeType: "image/png", kind: "image" });
    expect(checkUpload("THUMBNAIL", "cover.jpeg", pad([0xff, 0xd8, 0xff]))).toMatchObject({ ok: true, mimeType: "image/jpeg" });
    expect(checkUpload("MUSIC", "track.m4a", box("M4A "))).toMatchObject({ ok: true, mimeType: "audio/mp4" });
  });

  it("refuses a file of the wrong kind for the type, whatever the browser said", () => {
    expect(checkUpload("IMAGE", "photo.png", mp4)).toEqual({ ok: false, message: "photo.png: this is a video file (video/mp4), not an image." });
    expect(checkUpload("VIDEO", "clip.mp4", png)).toMatchObject({ ok: false, message: expect.stringMatching(/an image file \(image\/png\), not a video/) });
    expect(checkUpload("AUDIO", "song.mp3", png)).toMatchObject({ ok: false });
  });

  it("refuses an extension that doesn't belong to the format, and a missing one", () => {
    expect(checkUpload("VIDEO", "clip.mov", mp4)).toEqual({ ok: false, message: "clip.mov: the name ends in .mov but the file is video/mp4 (.mp4)." });
    expect(checkUpload("IMAGE", "photo.jpg", png)).toMatchObject({ ok: false, message: expect.stringMatching(/ends in \.jpg but the file is image\/png/) });
    expect(checkUpload("VIDEO", "clip", mp4)).toMatchObject({ ok: false, message: expect.stringMatching(/needs an extension \(\.mp4, \.m4v\)/) });
  });

  it("refuses unrecognised bytes and the OTHER type", () => {
    expect(checkUpload("VIDEO", "clip.mp4", pad("<html>"))).toMatchObject({ ok: false, message: expect.stringMatching(/not a recognised video file/) });
    expect(checkUpload("OTHER", "x.bin", mp4)).toMatchObject({ ok: false, message: expect.stringMatching(/can't be uploaded/) });
  });
});

describe("size caps and extensions", () => {
  it("caps images and audio below the video limit, and OTHER at nothing", () => {
    const max = 2 ** 31 - 1;
    expect(sizeCapFor("VIDEO", max)).toBe(max);
    expect(sizeCapFor("IMAGE", max)).toBe(25 * 1024 * 1024);
    expect(sizeCapFor("THUMBNAIL", max)).toBe(25 * 1024 * 1024);
    expect(sizeCapFor("AUDIO", max)).toBe(250 * 1024 * 1024);
    expect(sizeCapFor("MUSIC", 1000)).toBe(1000);
    expect(sizeCapFor("OTHER", max)).toBe(0);
  });
  it("reads the extension case-insensitively and only after a real dot", () => {
    expect(extensionOf("Clip.Final.MP4")).toBe("mp4");
    expect(extensionOf(".hidden")).toBe("");
    expect(extensionOf("noext")).toBe("");
  });
});

describe("hashAndPeek", () => {
  it("hashes the whole stream and keeps only the first bytes", async () => {
    const chunks = [new Uint8Array(3000).fill(1), new Uint8Array(3000).fill(2), new Uint8Array(10).fill(3)];
    const { stream, result } = hashAndPeek(4096);
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    const out: Uint8Array[] = [];
    for await (const ch of source.pipeThrough(stream) as unknown as AsyncIterable<Uint8Array>) out.push(ch);
    const r = result();
    expect(r.bytes).toBe(6010);
    expect(r.head.length).toBe(4096);
    expect(r.head[0]).toBe(1);
    expect(r.head[3000]).toBe(2);
    expect(r.sha256).toBe(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"));
    expect(Buffer.concat(out).length).toBe(6010); // everything passed through
  });
});
