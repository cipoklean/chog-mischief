import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import {
  NONCE_TTL_MS,
  buildSiweMessage,
  verifySiweSignature,
} from './siwe';

/**
 * These use REAL secp256k1 keypairs and real signatures, not mocks. A test that
 * only feeds malformed input proves the error path and nothing about the accept
 * path - and the accept path is the one that gates whether anyone can play.
 */
describe('SIWE verification with real signatures', () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const OTHER_KEY = generatePrivateKey();
  const other = privateKeyToAccount(OTHER_KEY);

  const NOW = new Date('2026-10-08T12:00:00.000Z');

  it('accepts a genuine signature from the claimed address', async () => {
    const { message } = buildSiweMessage({
      address: account.address,
      nonce: 'f00dcafe12345678',
      now: NOW,
    });
    const signature = await account.signMessage({ message });

    const r = await verifySiweSignature({
      message,
      signature,
      expectedAddress: account.address,
      now: NOW.getTime() + 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.recovered?.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('is case-insensitive on the address (wallets vary in checksum casing)', async () => {
    const { message } = buildSiweMessage({
      address: account.address.toLowerCase(),
      nonce: 'f00dcafe12345678',
      now: NOW,
    });
    const signature = await account.signMessage({ message });
    const r = await verifySiweSignature({
      message,
      signature,
      expectedAddress: account.address.toUpperCase().replace('0X', '0x'),
      now: NOW.getTime() + 1000,
    });
    expect(r.ok).toBe(true);
  });

  it('REJECTS a valid signature from a different wallet', async () => {
    // The attack this blocks: Alice signs, claims to be Bob. Without recovering
    // the signer and comparing, any valid signature would pass.
    const { message } = buildSiweMessage({
      address: other.address,
      nonce: 'f00dcafe12345678',
      now: NOW,
    });
    const signature = await other.signMessage({ message });
    const r = await verifySiweSignature({
      message,
      signature,
      expectedAddress: account.address, // claiming to be `account`
      now: NOW.getTime() + 1000,
    });
    expect(r.ok).toBe(false);
    expect(r.recovered?.toLowerCase()).toBe(other.address.toLowerCase());
  });

  it('REJECTS a tampered message even with a genuine signature', async () => {
    const { message } = buildSiweMessage({
      address: account.address,
      nonce: 'aaaaaaaaaaaaaaa1',
      now: NOW,
    });
    const signature = await account.signMessage({ message });
    // Swap the nonce: a replayed signature over a different challenge.
    const tampered = message.replace('aaaaaaaaaaaaaaa1', 'bbbbbbbbbbbbbbb2');
    const r = await verifySiweSignature({
      message: tampered,
      signature,
      expectedAddress: account.address,
      now: NOW.getTime() + 1000,
    });
    expect(r.ok).toBe(false);
  });

  it('REJECTS a signature over a message that has since expired', async () => {
    const { message } = buildSiweMessage({
      address: account.address,
      nonce: 'cccccccccccccc03',
      now: NOW,
    });
    const signature = await account.signMessage({ message });
    const r = await verifySiweSignature({
      message,
      signature,
      expectedAddress: account.address,
      now: NOW.getTime() + NONCE_TTL_MS + 1000,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expired/i);
  });

  it('ACCEPTS right up to the expiry boundary', async () => {
    const { message } = buildSiweMessage({
      address: account.address,
      nonce: 'dddddddddddddd04',
      now: NOW,
    });
    const signature = await account.signMessage({ message });
    const r = await verifySiweSignature({
      message,
      signature,
      expectedAddress: account.address,
      now: NOW.getTime() + NONCE_TTL_MS - 1000,
    });
    expect(r.ok).toBe(true);
  });
});
