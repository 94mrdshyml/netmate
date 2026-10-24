import { describe, expect, it } from "vitest";
import { checkPreviewUrl, isBlockedAddress, parseIPv4, parseIPv6 } from "@/links/address";

describe("checkPreviewUrl", () => {
  it("accepts http and https to a real domain on the usual ports", () => {
    for (const raw of ["https://example.com/a", "http://example.com/", "https://example.com:443/x", "http://example.com:80/x", "https://example.com:80/x", "https://sub.example.co.uk/p?q=1#h"]) {
      expect(checkPreviewUrl(raw).ok).toBe(true);
    }
  });

  it.each([
    ["ftp://example.com/", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["https://user:pw@example.com/", "login"],
    ["https://user@example.com/", "login"],
    ["https://example.com:8443/", "port"],
    ["http://example.com:22/", "port"],
    ["https://localhost/", "host"],
    ["https://app.localhost/", "host"],
    ["https://printer.local/", "host"],
    ["https://db.internal/", "host"],
    ["https://router.lan/", "host"],
    ["http://127.0.0.1/", "host"],
    ["http://2130706433/", "host"],
    ["http://0x7f.1/", "host"],
    ["http://0177.0.0.1/", "host"],
    ["http://[::1]/", "host"],
    ["http://[::ffff:10.0.0.1]/", "host"],
    ["http://169.254.169.254/latest/meta-data/", "host"],
    ["https://example/", "host"],
    ["https://exa_mple.com/", "host"],
    ["not a url", "host"],
    [`https://example.com/${"a".repeat(500)}`, "length"],
  ])("refuses %s", (raw, reason) => {
    expect(checkPreviewUrl(raw)).toEqual({ ok: false, reason });
  });
});

describe("parseIPv4 and parseIPv6", () => {
  it("read addresses and refuse what is not one", () => {
    expect(parseIPv4("10.0.0.1")).toEqual([10, 0, 0, 1]);
    expect(parseIPv4("256.0.0.1")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("1.2.3.4.5")).toBeNull();
    expect(parseIPv4("a.b.c.d")).toBeNull();
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("2001:db8::ff00:42:8329")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
    expect(parseIPv6("[fe80::1]")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:192.168.1.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101]);
    expect(parseIPv6("fe80::1%eth0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    for (const bad of ["1::2::3", "12345::1", "gggg::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "hello", "10.0.0.1", ""]) expect(parseIPv6(bad)).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.1.2.3", "169.254.169.254", "169.254.0.1",
    "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.5", "192.88.99.1", "192.168.0.1", "192.168.255.255", "198.18.0.1", "198.19.255.255",
    "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ])("refuses the IPv4 address %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.167.255.255", "192.169.0.1", "198.17.0.1", "198.20.0.1", "223.255.255.255", "11.0.0.1", "126.255.255.255", "128.0.0.1"])(
    "allows the public IPv4 address %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it.each([
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:7f00:1", "::ffff:192.168.0.1", "::ffff:a9fe:a9fe", "::10.0.0.1", "64:ff9b::7f00:1",
    "64:ff9b::a00:1", "2002:7f00:1::1", "2002:a00:1::", "2002:c0a8:101::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "100::1",
    "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "ff00::",
  ])("refuses the IPv6 address %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"])(
    "allows the public IPv6 address %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it("refuses anything that is not an address, so a bad DNS answer is never trusted", () => {
    for (const junk of ["", "example.com", "1.2.3", "::gg", "999.1.1.1", "10.0.0.1/8"]) expect(isBlockedAddress(junk)).toBe(true);
  });
});
