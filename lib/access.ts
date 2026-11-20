import "server-only";
import crypto from "node:crypto";
import { Challenge, isPrivate } from "./config";

export const newInviteCode = () => crypto.randomBytes(12).toString("hex");
export const isMember = (c: Challenge, address: string | null) => !!address && c.participants.some((p) => p.address === address);
export function inviteMatches(c: Challenge, invite: unknown) {
  if (typeof invite !== "string" || !c.inviteCode || invite.length !== c.inviteCode.length) return false;
  return crypto.timingSafeEqual(Buffer.from(invite), Buffer.from(c.inviteCode));
}
/** Public challenges are open. Private ones are visible only to participants and holders of the invite link. */
export const canView = (c: Challenge, address: string | null, invite?: unknown) => !isPrivate(c) || isMember(c, address) || inviteMatches(c, invite);
/** The invite code is shown only to participants, who can share it. */
export function viewFor(c: Challenge, address: string | null): Challenge {
  if (!c.inviteCode || isMember(c, address)) return c;
  const { inviteCode: _omit, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest as Challenge;
}
