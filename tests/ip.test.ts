import { describe, expect, it } from 'vitest';
import { classify, hasLeadingZeroOctet, inSubnet, isIPv6LinkLocal, netmaskToPrefix, parseCIDR, parseIP, parseIPv4, parseIPv6 } from '../src/lib/ip';

describe('IPv4 parsing', () => {
  it.each(['0.0.0.0', '192.168.1.1', '255.255.255.255', '10.0.0.10'])('accepts %s', (s) => {
    expect(parseIPv4(s)).not.toBeNull();
  });
  it.each(['192.168.1', '192.168.1.256', '1.2.3.4.5', '01.2.3.4', '1.2.3.04', ' 1.2.3.4', '1.2.3.4 ', '1..3.4', 'a.b.c.d', '', '+1.2.3.4', '1.2.3.-4'])('rejects %j', (s) => {
    expect(parseIPv4(s)).toBeNull();
  });
  it('detects leading zeros', () => {
    expect(hasLeadingZeroOctet('192.168.001.10')).toBe(true);
    expect(hasLeadingZeroOctet('192.168.1.10/24')).toBe(false);
    expect(hasLeadingZeroOctet('10.0.0.0')).toBe(false);
  });
});

describe('IPv6 parsing', () => {
  it.each(['::', '::1', '2001:db8::1', 'fe80::1', '2001:0db8:0000:0000:0000:0000:0000:0001', 'fd00:10::10', '::ffff:192.0.2.1', '1:2:3:4:5:6:7:8'])('accepts %s', (s) => {
    expect(parseIPv6(s)).not.toBeNull();
  });
  it.each(['2001:db8::1::2', '1:2:3:4:5:6:7:8:9', 'gggg::1', 'fe80::1%eth0', '12345::', ':1:2:3:4:5:6:7', '2001:db8:::1', ''])('rejects %j', (s) => {
    expect(parseIPv6(s)).toBeNull();
  });
  it('compresses equal values identically', () => {
    expect(parseIPv6('2001:db8::1')).toBe(parseIPv6('2001:0db8:0:0:0:0:0:1'));
  });
});

describe('CIDR and subnet helpers', () => {
  it('parses CIDR and validates prefix range', () => {
    expect(parseCIDR('192.168.1.10/24')?.prefix).toBe(24);
    expect(parseCIDR('2001:db8::1/64')?.family).toBe(6);
    expect(parseCIDR('192.168.1.10/33')).toBeNull();
    expect(parseCIDR('2001:db8::1/129')).toBeNull();
    expect(parseCIDR('192.168.1.10/024')).toBeNull();
    expect(parseCIDR('192.168.1.10/')).toBeNull();
  });
  it('checks subnet membership', () => {
    const net = parseCIDR('192.168.1.10/24')!;
    expect(inSubnet(parseIP('192.168.1.1')!, net)).toBe(true);
    expect(inSubnet(parseIP('192.168.2.1')!, net)).toBe(false);
    expect(inSubnet(parseIP('2001:db8::1')!, net)).toBe(false);
  });
  it('converts netmasks', () => {
    expect(netmaskToPrefix('255.255.255.0')).toBe(24);
    expect(netmaskToPrefix('255.255.252.0')).toBe(22);
    expect(netmaskToPrefix('0.0.0.0')).toBe(0);
    expect(netmaskToPrefix('255.255.255.255')).toBe(32);
    expect(netmaskToPrefix('255.0.255.0')).toBeNull();
    expect(netmaskToPrefix('255.255.255.1')).toBeNull();
    expect(netmaskToPrefix('255.255.255')).toBeNull();
  });
  it('classifies special addresses', () => {
    expect(classify(parseIP('127.0.0.1')!)).toBe('loopback');
    expect(classify(parseIP('224.0.0.1')!)).toBe('multicast');
    expect(classify(parseIP('255.255.255.255')!)).toBe('broadcast');
    expect(classify(parseIP('169.254.1.1')!)).toBe('link-local');
    expect(classify(parseIP('0.0.0.0')!)).toBe('unspecified');
    expect(classify(parseIP('::')!)).toBe('unspecified');
    expect(classify(parseIP('::1')!)).toBe('loopback');
    expect(classify(parseIP('ff02::1')!)).toBe('multicast');
    expect(classify(parseIP('192.168.1.1')!)).toBe('normal');
    expect(isIPv6LinkLocal(parseIP('fe80::1')!)).toBe(true);
    expect(isIPv6LinkLocal(parseIP('2001:db8::1')!)).toBe(false);
  });
});
