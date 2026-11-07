// Guard for URLs the server itself calls (a shop's WooCommerce site, outbound webhook targets).
// Without it an owner could make the server request internal addresses (SSRF). Production: https
// only, and every address the host resolves to must be public. Development allows http and private
// hosts so a local shop or a test server can be used.
const dns = require('node:dns/promises');
const net = require('node:net');

const PRIVATE = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(address, prefix, 'ipv6');

function isPrivateAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4 written as IPv6
  if (mapped) return PRIVATE.check(mapped[1], 'ipv4');
  return PRIVATE.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/**
 * @returns {Promise<{ ok: true, url: string } | { ok: false, error: string }>}
 * shortcut: checks DNS once before the request (a host could re-resolve to a private address in
 * between — DNS rebinding); pin the resolved address in the request if this is ever exposed widely.
 */
async function checkUrl(raw, { allowPrivate = false } = {}) {
  let url;
  try { url = new URL(String(raw ?? '').trim()); } catch { return { ok: false, error: 'آدرس نامعتبر است' }; }
  if (url.username || url.password) return { ok: false, error: 'آدرس نباید نام کاربری یا رمز داشته باشد' };
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return { ok: false, error: 'آدرس باید با https:// شروع شود' };
  if (allowPrivate) return { ok: true, url: url.toString() };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, error: 'دامنهٔ این آدرس پیدا نشد' };
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, error: 'این آدرس به یک شبکهٔ داخلی اشاره می‌کند و مجاز نیست' };
  return { ok: true, url: url.toString() };
}

module.exports = { checkUrl, isPrivateAddress };
