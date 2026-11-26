import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyDomain, fetchCompanyMeta, isPublicAddress } from "./company";
import { growth } from "./fixtures/growth";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

describe("companyDomain", () => {
  it.each([
    ["https://www.Vinted.com/careers", "vinted.com"],
    ["VINTED.COM", "vinted.com"],
    ["vinted.com", "vinted.com"],
    ["www.vinted.com/about?team=eng#jobs", "vinted.com"],
    ["  https://vinted.lt  ", "vinted.lt"],
    ["careers.eu.vinted.com", "vinted.com"],
    ["http://vinted.com:8443/", "vinted.com"],
    ["https://www.bbc.co.uk/news", "bbc.co.uk"],
    ["shop.example.com.au", "example.com.au"],
    ["vinted.com.", "vinted.com"],
    ["https://vinted.com./careers", "vinted.com"],
  ])("normalises %j to %j", (input, domain) => {
    expect(companyDomain(input)).toBe(domain);
  });

  it.each([
    ["münchen.de", "xn--mnchen-3ya.de"],
    ["https://www.MÜNCHEN.de/kontakt", "xn--mnchen-3ya.de"],
    ["xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
    ["ⓥinted.com", "vinted.com"],
    ["ｖｉｎｔｅｄ．ｃｏｍ", "vinted.com"],
    ["пример.рф", "xn--e1afmkfd.xn--p1ai"],
  ])("canonicalises the Unicode host %j to %j", (input, domain) => {
    expect(companyDomain(input)).toBe(domain);
  });

  it("stores the same host that fetch would use", () => {
    for (const input of ["ⓥinted.com", "münchen.de"]) expect(companyDomain(input)).toBe(new URL(`https://${input}/`).hostname);
  });

  it("maps every way of writing the same website to one Company", () => {
    const inputs = ["https://www.vinted.com", "http://vinted.com/", "Vinted.com", "www.VINTED.com/lt", "jobs.vinted.com"];
    expect(new Set(inputs.map(companyDomain))).toEqual(new Set(["vinted.com"]));
  });

  it.each([
    ["an IPv4 address", "http://192.168.1.10/"],
    ["a public IPv4 address", "8.8.8.8"],
    ["an IPv6 address", "http://[2001:db8::1]/"],
    ["localhost", "localhost"],
    ["localhost with a port", "http://localhost:3000"],
    ["a bare internal name", "intranet"],
    ["a .local name", "printer.local"],
    ["an .internal name", "app.internal"],
    ["a .lan name", "corp.lan"],
    ["a home.arpa name", "nas.home.arpa"],
    ["a bare public suffix", "co.uk"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["words", "not a website"],
    ["a scheme alone", "https://"],
    ["junk", "%%%"],
    ["a script URL", "javascript:alert(1)"],
    ["an IPv4 address written as a number", "2130706433"],
    ["an IPv4 address written in hex", "0x7f.1"],
  ])("refuses %s", (_, input) => {
    expect(companyDomain(input)).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "198.20.0.1", "203.0.114.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"])("accepts %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv4 loopback range", "127.10.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 loopback written out", "0:0:0:0:0:0:0:1"],
    ["IPv4 private 10/8", "10.1.2.3"],
    ["IPv4 private 172.16/12", "172.16.0.1"],
    ["IPv4 private 172.16/12, top", "172.31.255.255"],
    ["IPv4 private 192.168/16", "192.168.0.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["IPv4 link-local (cloud metadata)", "169.254.169.254"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with a zone", "fe80::1%en0"],
    ["IPv6 unique local", "fd12:3456:789a::1"],
    ["this network", "0.0.0.0"],
    ["IPv6 unspecified", "::"],
    ["IPv4 multicast", "224.0.0.1"],
    ["IPv4 broadcast", "255.255.255.255"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped IPv6 private", "::ffff:10.0.0.1"],
    ["IPv4-mapped IPv6 metadata, in hex", "::ffff:a9fe:a9fe"],
    ["IPv4-mapped IPv6 benchmarking", "::ffff:198.18.0.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["documentation TEST-NET-1", "192.0.2.1"],
    ["documentation TEST-NET-2", "198.51.100.1"],
    ["documentation TEST-NET-3", "203.0.113.1"],
    ["former 6to4 relay", "192.88.99.1"],
    ["benchmarking", "198.18.0.1"],
    ["benchmarking, top", "198.19.255.255"],
    ["reserved 240/4", "240.0.0.1"],
    ["IPv4-compatible IPv6 private", "::10.0.0.1"],
    ["IPv4-compatible IPv6 loopback", "::7f00:1"],
    ["NAT64 to loopback", "64:ff9b::7f00:1"],
    ["NAT64 to private", "64:ff9b::10.0.0.1"],
    ["local-use NAT64", "64:ff9b:1::a00:1"],
    ["6to4 embedding loopback", "2002:7f00:1::"],
    ["6to4 embedding private", "2002:c0a8:101::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["IPv6 discard", "100::1"],
    ["IPv6 site-local", "fec0::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 documentation 3fff::/20", "3fff::1"],
  ])("refuses %s (%s)", (_, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["", "localhost", "example.com", "999.1.1.1", "2130706433"])("refuses %j, which is not an IP address", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("fetchCompanyMeta", () => {
  const dns = vi.mocked(lookup);
  const fetchMock = vi.fn<typeof fetch>();
  const resolvesTo = (...addresses: string[]) =>
    dns.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })) as never);
  // Per-host DNS answers; an unknown host does not resolve.
  const hosts = (answers: Record<string, string>) =>
    dns.mockImplementation((async (host: string) => {
      if (!answers[host]) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      return [{ address: answers[host], family: answers[host].includes(":") ? 6 : 4 }];
    }) as never);
  const page = (html: string) => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
  const fetched = () => fetchMock.mock.calls.map(([url]) => String(url));
  const fallback = { name: "vinted.com", logoUrl: null };

  beforeEach(() => {
    dns.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resolvesTo("93.184.215.14");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the name and logo from the Company's website", async () => {
    fetchMock.mockResolvedValue(
      page(`<html><head><title>Vinted | Buy and sell</title><meta property="og:site_name" content="Vinted"><link rel="icon" href="/favicon.png"></head></html>`),
    );
    expect(await fetchCompanyMeta("vinted.com")).toEqual({ name: "Vinted", logoUrl: "https://vinted.com/favicon.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://vinted.com/");
  });

  it("falls back to the page title, keeping a hyphenated name whole", async () => {
    fetchMock.mockResolvedValue(page(`<title>Mercedes-Benz | Home</title>`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe("Mercedes-Benz");
    fetchMock.mockResolvedValue(page(`<title>\n  Vinted - Buy and sell\n</title>`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe("Vinted");
  });

  it("uses the domain as the name when the page has none", async () => {
    fetchMock.mockResolvedValue(page(`<html><body>Hello</body></html>`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
  });

  it("falls back to the domain when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
  });

  it("falls back to the domain when the website answers with an error", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
  });

  it("follows a redirect to www on the Company's own domain, checking the new host", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("https://www.vinted.com/"))
      .mockResolvedValueOnce(page(`<meta property="og:site_name" content="Vinted"><link rel="icon" href="/favicon.ico">`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual({ name: "Vinted", logoUrl: "https://www.vinted.com/favicon.ico" });
    expect(fetched()).toEqual(["https://vinted.com/", "https://www.vinted.com/"]);
    // fetch itself never follows a redirect.
    expect(fetchMock.mock.calls.map(([, init]) => init?.redirect)).toEqual(["manual", "manual"]);
    expect(dns.mock.calls.map(([host]) => host)).toEqual(["vinted.com", "www.vinted.com"]);
  });

  it("follows a relative redirect and resolves the logo against the final page", async () => {
    fetchMock.mockResolvedValueOnce(redirect("/lt-lt/", 307)).mockResolvedValueOnce(page(`<title>Bolt</title><link rel="icon" href="icon.png">`));
    expect(await fetchCompanyMeta("bolt.eu")).toEqual({ name: "Bolt", logoUrl: "https://bolt.eu/lt-lt/icon.png" });
  });

  it("accepts the default port written out", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://www.vinted.com:443/", 301)).mockResolvedValueOnce(page(`<title>Vinted</title>`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe("Vinted");
  });

  it("follows up to three redirects", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("https://www.vinted.com/"))
      .mockResolvedValueOnce(redirect("/lt/", 301))
      .mockResolvedValueOnce(redirect("https://www.vinted.com/lt/home", 308))
      .mockResolvedValueOnce(page(`<title>Vinted</title>`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe("Vinted");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up after three redirects", async () => {
    for (const hop of ["/1", "/2", "/3", "/4"]) fetchMock.mockResolvedValueOnce(redirect(hop));
    fetchMock.mockResolvedValueOnce(page(`<title>Vinted</title>`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["to another domain", "https://vinted.lt/"],
    ["to a look-alike domain", "https://vinted.com.evil.example/"],
    ["to plain http", "http://www.vinted.com/"],
    ["to another port", "https://www.vinted.com:8443/"],
    ["with credentials", "https://user:secret@www.vinted.com/"],
    ["to an IP address", "https://169.254.169.254/latest/meta-data/"],
    ["to cloud metadata over http", "http://169.254.169.254/latest/meta-data/"],
  ])("refuses a redirect %s", async (_, location) => {
    fetchMock.mockResolvedValueOnce(redirect(location)).mockResolvedValueOnce(page(`<title>Elsewhere</title>`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a host on the Company's domain that resolves to a private address", async () => {
    hosts({ "vinted.com": "93.184.215.14", "intranet.vinted.com": "10.0.0.5" });
    fetchMock.mockResolvedValueOnce(redirect("https://intranet.vinted.com/")).mockResolvedValueOnce(page(`<title>Internal</title>`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a redirect without a Location as a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
  });

  it.each([
    ["content before property", `<meta content="Acme" property="og:site_name"><link href="/i.png" rel="icon">`],
    ["name instead of property", `<meta name="og:site_name" content="Acme"><link rel="icon" href="/i.png">`],
    ["single quotes", `<meta property='og:site_name' content='Acme'><link rel='icon' href='/i.png'>`],
    ["no quotes and look-alike attributes", `<meta data-content="Wrong" property=og:site_name content=Acme><link type="image/png" href=/i.png rel=icon sizes="32x32">`],
    ["upper case and line breaks", `<META\n  CONTENT="Acme"\n  PROPERTY="OG:SITE_NAME"><LINK\nHREF="/i.png"\nREL="Icon">`],
    ["other meta tags first", `<meta property="og:title" content="Wrong"><link rel="stylesheet" href="/a.css"><meta property="og:site_name" content="Acme"><link rel="icon" href="/i.png">`],
  ])("reads the name and logo with %s", async (_, html) => {
    fetchMock.mockResolvedValue(page(html));
    expect(await fetchCompanyMeta("vinted.com")).toEqual({ name: "Acme", logoUrl: "https://vinted.com/i.png" });
  });

  it("decodes entities in the name and the logo address", async () => {
    fetchMock.mockResolvedValue(page(`<meta property="og:site_name" content="Marks &amp; Spencer"><link rel="icon" href="/logo.png?v=1&amp;s=32">`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual({ name: "Marks & Spencer", logoUrl: "https://vinted.com/logo.png?v=1&s=32" });
  });

  it.each([
    [`<title>Ben &#38; Jerry&#x27;s &ndash; Ice cream</title>`, "Ben & Jerry's"],
    [`<title>&quot;Quoted&quot; &lt;Co&gt; &#8212; Home</title>`, `"Quoted" <Co>`],
    [`<title>Caf&eacute; &bogus; &#0; &#x110000;</title>`, "Caf&eacute; &bogus; &#0; &#x110000;"],
  ])("decodes entities in %j before cutting at the separator", async (html, name) => {
    fetchMock.mockResolvedValue(page(html));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe(name);
  });

  it.each([
    ["NUL, which Postgres refuses in text", "Vin\u0000ted", "Vin ted"],
    ["a NUL written as an entity", "Vin&#0;ted", "Vin&#0;ted"],
    ["other control characters", "Vin\u0001ted\u007f Co\u0085", "Vin ted Co"],
    ["a control character written as an entity", "Vin&#1;ted", "Vin ted"],
    ["a right-to-left override", "‮detniV", "detniV"],
    ["a right-to-left override written as an entity", "&#x202E;detniV &#8206;Co", "detniV Co"],
    ["invisible characters", "﻿Vin​ted⁦", "Vinted"],
  ])("strips %s from the name", async (_, raw, name) => {
    fetchMock.mockResolvedValue(page(`<meta property="og:site_name" content="${raw}">`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe(name);
    fetchMock.mockResolvedValue(page(`<title>${raw} | Home</title>`));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe(name);
  });

  it("collapses whitespace and caps the name at 80 characters", async () => {
    fetchMock.mockResolvedValue(page(`<meta property="og:site_name" content="  Acme\n\t  Holdings ${"é".repeat(200)}">`));
    const { name } = await fetchCompanyMeta("vinted.com");
    expect(name.startsWith("Acme Holdings éé")).toBe(true);
    expect([...name]).toHaveLength(80);
  });

  // One pass takes about eight times as long for eight times the page; a pass that went back over it for each
  // character would take sixty-four (lib/fixtures/growth.ts). Both sizes fit in half the 200 KB that is read, so that
  // both are read whole the same way (at the limit, reading sometimes stops early), and let such a pass end, and fail,
  // in seconds. Each page is `before`, then `unit` `count` times, then `after`.
  it.each([
    ["repeated meta prefixes", "", `<meta name="og:site_name" `, 8_000, ""],
    ["repeated link prefixes", "", `<link rel="icon" `, 12_000, ""],
    ["repeated title openings", "", `<title`, 34_000, ""],
    ["an unterminated title", `<title>`, `Acme `, 40_000, ""],
    ["an unterminated attribute", `<meta property="og:site_name" content="`, `a`, 200_000, ""],
    ["repeated attributes in one tag", `<meta`, ` content= property=`, 11_000, `>`],
    ["an unterminated entity", `<title>&#x`, `1`, 200_000, ""],
    ["spaces and joiners in turn", `<title>x`, ` ‍`, 100_000, `y`],
    ["a name ending in spaces and joiners", `<meta property="og:site_name" content="x`, ` ‍`, 100_000, `">`],
  ])("reads 200 KB of hostile HTML (%s) in one pass", { timeout: 30_000 }, async (_, before, unit, count, after) => {
    const make = (n: number) => before + unit.repeat(n) + after;
    const read = (html: string) => {
      fetchMock.mockImplementation(async () => page(html));
      return fetchCompanyMeta("vinted.com");
    };
    expect(make(count).length).toBeGreaterThanOrEqual(200_000);
    expect([...(await read(make(count))).name].length).toBeLessThanOrEqual(80);
    const sixteenth = Math.floor((200_000 - Buffer.byteLength(before + after)) / Buffer.byteLength(unit) / 16);
    expect(await growth(read, make, sixteenth)).toBeLessThan(24);
  });

  it("stops reading the body after the first 200 KB", async () => {
    const encoder = new TextEncoder();
    const filler = encoder.encode(`<!-- ${"x".repeat(16_000)} -->`);
    let sent = 0;
    let cancelled = false;
    // An endless body, like a decompression bomb.
    const body = new ReadableStream<Uint8Array>({
      start: (c) => c.enqueue(encoder.encode(`<title>Vinted</title>`)),
      pull: (c) => {
        sent += filler.byteLength;
        c.enqueue(filler);
      },
      cancel: () => {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    expect((await fetchCompanyMeta("vinted.com")).name).toBe("Vinted");
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(sent).toBeLessThan(250_000);
  });

  it("fetches the canonical host of a Unicode domain", async () => {
    fetchMock.mockResolvedValue(page(`<title>München</title>`));
    const domain = companyDomain("münchen.de")!;
    expect(await fetchCompanyMeta(domain)).toEqual({ name: "München", logoUrl: null });
    expect(fetched()).toEqual(["https://xn--mnchen-3ya.de/"]);
    expect(dns).toHaveBeenCalledWith("xn--mnchen-3ya.de", { all: true });
  });

  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:192.168.1.1"])(
    "does not fetch a domain that resolves to %s",
    async (address) => {
      resolvesTo(address);
      expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not fetch a domain when any of its addresses is private", async () => {
    resolvesTo("93.184.215.14", "10.0.0.5");
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch a domain that does not resolve", async () => {
    dns.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    expect(await fetchCompanyMeta("vinted.com")).toEqual(fallback);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["localhost", "192.168.1.1", "intranet"])("does not look up or fetch %j", async (input) => {
    expect(await fetchCompanyMeta(input)).toEqual({ name: input, logoUrl: null });
    expect(dns).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["on another domain", "https://cdn.othercompany.com/logo.png"],
    ["on a look-alike domain", "https://vinted.com.evil.example/logo.png"],
    ["protocol-relative on another domain", "//evil.example/logo.png"],
    ["over plain http", "http://vinted.com/logo.png"],
    ["inline as data", "data:image/png;base64,AAAA"],
  ])("rejects a logo %s", async (_, href) => {
    fetchMock.mockResolvedValue(page(`<meta property="og:site_name" content="Vinted"><link rel="icon" href="${href}">`));
    expect(await fetchCompanyMeta("vinted.com")).toEqual({ name: "Vinted", logoUrl: null });
  });

  it("accepts a logo on a subdomain of the Company's own domain", async () => {
    fetchMock.mockResolvedValue(page(`<link rel="shortcut icon" href="https://static.vinted.com/logo.svg">`));
    expect((await fetchCompanyMeta("vinted.com")).logoUrl).toBe("https://static.vinted.com/logo.svg");
  });
});
