import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Where synthetic checks and webhooks may connect. Link-local, cloud metadata
 * and reserved addresses are always refused; private and loopback networks
 * too when BLOCK_PRIVATE_TARGETS is set (checking your own local apps is a
 * normal use on a laptop, less so on a shared server). Set at startup.
 */
export const networkPolicy = { blockPrivate: false };

const alwaysBlocked = new BlockList();
alwaysBlocked.addSubnet('0.0.0.0', 8, 'ipv4');
alwaysBlocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, including cloud metadata (169.254.169.254)
alwaysBlocked.addAddress('100.100.100.200', 'ipv4'); // Alibaba Cloud metadata
alwaysBlocked.addSubnet('224.0.0.0', 3, 'ipv4'); // multicast, reserved and broadcast
alwaysBlocked.addAddress('::', 'ipv6');
alwaysBlocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
alwaysBlocked.addSubnet('ff00::', 8, 'ipv6'); // multicast
alwaysBlocked.addAddress('fd00:ec2::254', 'ipv6'); // AWS metadata over IPv6

const privateNetworks = new BlockList();
privateNetworks.addSubnet('10.0.0.0', 8, 'ipv4');
privateNetworks.addSubnet('172.16.0.0', 12, 'ipv4');
privateNetworks.addSubnet('192.168.0.0', 16, 'ipv4');
privateNetworks.addSubnet('127.0.0.0', 8, 'ipv4');
privateNetworks.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
privateNetworks.addAddress('::1', 'ipv6');
privateNetworks.addSubnet('fc00::', 7, 'ipv6'); // unique local

/** Why minidog will not connect to an IP address, or null (also for host names). */
export function blockedReason(address: string, blockPrivate: boolean = networkPolicy.blockPrivate): string | null {
  let ip = address.replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  const family = isIP(ip);
  if (family === 0) return null;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (alwaysBlocked.check(ip, type)) return 'link-local, cloud metadata or reserved address';
  if (blockPrivate && privateNetworks.check(ip, type))
    return 'private or loopback address (BLOCK_PRIVATE_TARGETS is set)';
  return null;
}

export class BlockedAddressError extends Error {
  readonly code = 'EBLOCKED';

  constructor(host: string, address: string, reason: string) {
    super(`Blocked ${address === host ? host : `${host} (${address})`}: ${reason}`);
    this.name = 'BlockedAddressError';
  }
}

/** IP literals connect without a DNS lookup, so they are checked before connecting. */
export function checkHost(hostname: string, blockPrivate?: boolean): BlockedAddressError | null {
  const host = hostname.replace(/^\[|\]$/g, '');
  const reason = blockedReason(host, blockPrivate);
  return reason ? new BlockedAddressError(host, host, reason) : null;
}

/**
 * A `lookup` for http.request that refuses hosts resolving to a blocked address.
 *
 * `blockPrivate` is read per request, because the policy is set at startup after
 * this module loads. Requests minidog makes on its own behalf — the heartbeat,
 * which an operator configures — pass `false`: keeping those off the local
 * network protects nobody, and would silently break a watcher on the same LAN.
 */
export function lookupGuardedBy(
  blockPrivate: () => boolean,
): (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, resolved) => {
      if (error) return callback(error, '');
      const addresses = resolved as unknown as LookupAddress[];
      for (const entry of addresses) {
        const reason = blockedReason(entry.address, blockPrivate());
        if (reason) return callback(new BlockedAddressError(hostname, entry.address, reason), '');
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/** The guard for synthetic checks and webhooks: follows BLOCK_PRIVATE_TARGETS. */
export const guardedLookup = lookupGuardedBy(() => networkPolicy.blockPrivate);
