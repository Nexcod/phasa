/**
 * ID-token check (docs/plan.md §8.2 step 6), as OpenAI's own example does it: `jose` with the
 * JWKS, issuer, audience = the issued client id, `sub`/`exp`/`iat` present, 5 s clock tolerance,
 * and our nonce.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ISSUER, JWKS_URL, OAuthError } from './oauth';

export interface IdentityClaims {
  sub: string;
  email?: string;
  name?: string;
}

export type KeySource = JWTVerifyGetKey;

/** OpenAI's signing keys; jose caches them and refetches for an unknown `kid`. */
export function openAiKeys(): KeySource {
  return createRemoteJWKSet(new URL(JWKS_URL));
}

export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  keys: KeySource,
  now?: number,
): Promise<IdentityClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: ISSUER,
      audience: expected.clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 5,
      ...(now === undefined ? {} : { currentDate: new Date(now) }),
    }));
  } catch (error) {
    const code = error instanceof errors.JOSEError ? error.code : 'ERR_UNKNOWN';
    throw new OAuthError('invalid_id_token', 0, `ID token rejected (${code})`);
  }
  if (payload.nonce !== expected.nonce) {
    throw new OAuthError('invalid_id_token', 0, 'ID token nonce does not match');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new OAuthError('invalid_id_token', 0, 'ID token has no subject');
  }
  const claims: IdentityClaims = { sub: payload.sub };
  if (typeof payload.email === 'string') claims.email = payload.email;
  if (typeof payload.name === 'string') claims.name = payload.name;
  return claims;
}
