/** IPv4 helpers (pure, no dependencies). */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpv4(s: string): boolean {
  return IPV4.test(s.trim());
}

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function maskOf(prefix: number): number {
  return prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToMask(prefix: number): string {
  return intToIp(maskOf(prefix));
}

export function parseCidr(cidr: string): { network: number; prefix: number } {
  const [ip, p] = cidr.split('/');
  const prefix = Number(p);
  return { network: (ipToInt(ip) & maskOf(prefix)) >>> 0, prefix };
}

export function inCidr(ip: string, cidr: string): boolean {
  if (!isIpv4(ip)) return false;
  const { network, prefix } = parseCidr(cidr);
  return ((ipToInt(ip) & maskOf(prefix)) >>> 0) === network;
}

export function sameSubnet(a: string, b: string, prefix: number): boolean {
  if (!isIpv4(a) || !isIpv4(b)) return false;
  const m = maskOf(prefix);
  return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0);
}

export function networkAddress(ip: string, prefix: number): string {
  return intToIp((ipToInt(ip) & maskOf(prefix)) >>> 0);
}

/** Network or broadcast address of its own subnet: not usable by a host. */
export function isReservedHost(ip: string, prefix: number): boolean {
  if (prefix >= 31) return false;
  const hostMask = ~maskOf(prefix) >>> 0;
  const host = (ipToInt(ip) & hostMask) >>> 0;
  return host === 0 || host === hostMask;
}

export function isLinkLocal(ip: string): boolean {
  return inCidr(ip, '169.254.0.0/16');
}
