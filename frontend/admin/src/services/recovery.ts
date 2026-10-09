/** What a recovery code is for. The server issues a separate code per purpose. */
export type RecoveryPurpose = "password" | "username";

/** Timing a successful code request reports; each field is absent when the backend sends none. */
export interface CodeRequestResult {
  /** How long the issued code stays valid. */
  expiresInSeconds?: number;
  /** How long before another code may be requested. */
  resendAfterSeconds?: number;
}

/** A verified or completed recovery step. The username is what login is prefilled with. */
export interface RecoveryResult {
  username: string;
}
