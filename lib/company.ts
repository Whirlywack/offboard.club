// A Company is identified by the registrable domain of the website a Member enters.

import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { parse } from "tldts";
import { tidy } from "./profile";

// "https://www.Vinted.com/careers" -> "vinted.com". Null if it is not a public website address.
export function companyDomain(input: string): string | null {
  // The URL parser applies IDNA, so "München.de" and "xn--mnchen-3ya.de" are one Company, and
  // "ⓥinted.com" is "vinted.com": the domain stored is the host that would be fetched.
  const host = URL.parse(`https://${input.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, "")}`)?.hostname ?? "";
  const p = parse(host);
  // isIcann rules out IPs, "localhost", ".internal" and other names that are not on the public web.
  // .arpa is ICANN's but holds no websites, only infrastructure such as home.arpa for home networks.
  return p.domain && p.isIcann && !p.isIp && !p.domain.endsWith(".arpa") ? p.domain : null;
}

// Special-purpose blocks (IANA registries) that are not globally reachable, or that embed or
// translate to an IPv4 address and so could reach any of them.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], ["198.51.100.0", 24], ["203.0.113.0", 24], // documentation
  ["192.88.99.0", 24], // former 6to4 relays
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 3], // multicast, reserved 240/4 and broadcast
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], // NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], ["3fff::", 20], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], ["fec0::", 10], // link-local, former site-local
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(net, bits, "ipv6");

// BlockList also matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the ipv4 rules.
export const isPublicAddress = (ip: string) =>
  isIP(ip) !== 0 && !blocked.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

// A public domain can still resolve to an internal address, so check what it resolves to.
// ponytail: checks at lookup time only; pin the resolved address into the request
// if this fetch ever runs somewhere with access to a private network.
export async function resolvesPublicly(domain: string): Promise<boolean> {
  const addresses = await lookup(domain, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

const MAX_BYTES = 200_000;
const MAX_REDIRECTS = 3;
const MAX_NAME = 80;

// Every request, the first and each redirect, must be https on the default port, carry no
// credentials, stay within the Company's own domain and resolve to public addresses.
const mayFetch = async (url: URL, domain: string) =>
  url.protocol === "https:" && url.port === "" && !url.username && !url.password &&
  companyDomain(url.hostname) === domain && (await resolvesPublicly(url.hostname));

// Name and logo for a new Company, taken from its website. Falls back to the domain.
export async function fetchCompanyMeta(domain: string): Promise<{ name: string; logoUrl: string | null }> {
  const fallback = { name: domain, logoUrl: null };
  try {
    const signal = AbortSignal.timeout(5000);
    let url = new URL(`https://${domain}/`);
    for (let hops = 0; ; hops++) {
      if (!(await mayFetch(url, domain))) return fallback;
      // Redirects are followed by hand so that each target passes the same checks.
      const res = await fetch(url, { redirect: "manual", signal });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res.ok ? pageMeta(await readStart(res), url, domain) : fallback;
      await res.body?.cancel();
      if (hops === MAX_REDIRECTS) return fallback;
      url = new URL(location, url);
    }
  } catch {
    return fallback;
  }
}

// The first MAX_BYTES of the body; the rest is never downloaded or decompressed.
async function readStart(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader && size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader?.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

// Every pattern here is linear: none can rescan the same text, so hostile HTML cannot stall the server.
function pageMeta(html: string, base: URL, domain: string) {
  const tags = html.match(/<(?:meta|link)\b[^<>]*>/gi) ?? [];
  const siteTag = tags.find((t) => /^<meta/i.test(t) && (attr(t, "property") ?? attr(t, "name"))?.toLowerCase() === "og:site_name");
  const iconTag = tags.find((t) => /^<link/i.test(t) && /\bicon\b/i.test(attr(t, "rel") ?? ""));
  const siteName = siteTag && attr(siteTag, "content");
  const title = html.match(/<title\b[^<>]*>([^<]*)/i)?.[1];
  // "Mercedes-Benz | Home" -> "Mercedes-Benz": only a spaced separator ends the name.
  const name = siteName ? text(siteName) : title ? text(title).split(/ [|–—-] /)[0] : "";
  const href = iconTag && attr(iconTag, "href");
  const logo = href ? URL.parse(decode(href), base) : null;
  return {
    name: tidy([...name].slice(0, MAX_NAME).join("")) || domain,
    // Only keep a logo served from the Company's own domain over https.
    logoUrl: logo && logo.protocol === "https:" && companyDomain(logo.hostname) === domain ? logo.href : null,
  };
}

// One attribute of a tag, in any order, quoted or not.
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== "#") return entities[e.toLowerCase()] ?? whole;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

// Decoded and tidied as Profile fields are: control characters such as NUL, which Postgres refuses in text, and
// invisible or bidirectional characters, which could disguise the name, do not reach the database.
const text = (s: string) => tidy(decode(s));
