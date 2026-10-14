// Links people paste for media are stored and rendered as href / src, and may
// be downloaded by the server later (platform uploads). Only public https
// URLs are accepted.

function isPrivateHost(hostname: string) {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // WHATWG URL parsing already turns shorthand like "2130706433" into dotted IPv4
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast / reserved
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local (cloud metadata)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (h.includes(":")) {
    return h === "::" || h === "::1" || /^f[cd]/.test(h) || h.startsWith("fe80") || h.startsWith("::ffff:");
  }
  return false;
}

/** Why `raw` can't be used as a media link, or null when it's a public https URL. */
export function mediaLinkProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Enter a valid URL.";
  }
  if (url.protocol !== "https:") return "Only https links are allowed.";
  if (url.username || url.password) return "Links can't contain a user name or password.";
  if (isPrivateHost(url.hostname)) return "Links to local or private network addresses aren't allowed.";
  return null;
}
