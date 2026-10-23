import { describe, expect, it } from "vitest";
import { MAX_BYTES, sniffImage } from "@/storage/images";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe("sniffImage", () => {
  it("recognises the four allowed types by their first bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1))).toBe("jpg");
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(text("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000"))).toBe("gif");
    expect(sniffImage(text("GIF87a\u0001\u0000\u0001\u0000\u0000\u0000"))).toBe("gif");
    expect(sniffImage(text("RIFF\u0010\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
  });

  it.each([
    ["an SVG", text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["HTML", text("<!doctype html><script>alert(1)</script>")],
    ["a script", text("#!/bin/sh\nrm -rf /\n")],
    ["a Windows program", text("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000")],
    ["a WAV file (RIFF but not WEBP)", text("RIFF\u0010\u0000\u0000\u0000WAVEfmt ")],
    ["a PDF", text("%PDF-1.7\n%....")],
    ["a truncated PNG", bytes(0x89, 0x50, 0x4e, 0x47)],
    ["a truncated JPEG", bytes(0xff, 0xd8)],
    ["nothing", new Uint8Array(0)],
    ["a JPEG signature with a wrong third byte", bytes(0xff, 0xd8, 0x00, 0xe0)],
  ])("refuses %s", (_name, data) => {
    expect(sniffImage(data)).toBeNull();
  });
});

describe("limits", () => {
  it("allow 2 MB for avatars and 5 MB for covers and post photos", () => {
    expect(MAX_BYTES.avatar).toBe(2 * 1024 * 1024);
    expect(MAX_BYTES.banner).toBe(5 * 1024 * 1024);
    expect(MAX_BYTES.post).toBe(5 * 1024 * 1024);
  });
});
