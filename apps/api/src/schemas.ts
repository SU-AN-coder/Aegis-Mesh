import { z } from "zod";

export const routeQuoteSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(["safe", "cheap", "fast"]).default("safe"),
  sourceSnapshotId: z.string().min(1).optional(),
});

export const sponsorRouteSchema = z.object({
  passId: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(["safe", "cheap", "fast"]),
  characterId: z.string().min(1),
  allianceId: z.string().min(1),
  sourceGateId: z.string().min(1),
  destinationGateId: z.string().min(1),
  locationProof: z.string().min(1).optional(),
  sponsorProvider: z.enum(["dapp-kit", "custom"]).default("custom"),
});

export const distressSchema = z.object({
  allianceId: z.string().min(1),
  characterId: z.string().min(1),
  systemId: z.string().min(1),
  threatLevel: z.enum(["low", "medium", "high", "critical"]),
  locationProof: z.string().min(1).optional(),
  bondAmount: z.number().int().positive().optional(),
  chainDigest: z.string().regex(/^0x[a-fA-F0-9]+$/).nullable().optional(),
});

export const policySchema = z.object({
  mode: z.enum(["ceasefire", "blockade", "wartime"]),
  tollBase: z.number().int().min(0),
  riskMultiplier: z.number().positive(),
  civilianProtection: z.boolean(),
  treatyExemptions: z.array(z.string()),
  redlist: z.array(z.string()),
  whitelist: z.array(z.string()),
  expectedVersion: z.number().int().positive().optional(),
});

export const incidentAttachSchema = z.object({
  incidentId: z.string().min(1),
  beaconId: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  allianceId: z.string().min(1),
  summary: z.string().min(1),
  operatorComment: z.string().min(1).optional(),
  killmailRef: z.string().nullable().default(null),
  evidenceHashes: z.array(z.string().min(1)).default([]),
  evidenceCount: z.number().int().min(0).default(1),
  chainDigest: z.string().regex(/^0x[a-fA-F0-9]+$/).nullable().optional(),
  chainEventSeq: z.string().regex(/^\d+$/).nullable().optional(),
  sourceSnapshotId: z.string().min(1).optional(),
  sourceEventRange: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    })
    .optional(),
});

export const routePassConsumeSchema = z.object({
  routePassId: z.string().min(1),
  allianceId: z.string().min(1),
  permitDigest: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export const responderAcceptSchema = z.object({
  beaconId: z.string().min(1),
  allianceId: z.string().min(1),
  responderId: z.string().min(1),
  bondAmount: z.number().int().positive().max(1_000_000),
});

export const auditorApproveSchema = z.object({
  incidentId: z.string().min(1),
  allianceId: z.string().min(1),
  auditorComment: z.string().min(1).max(2000),
});

export const insurerApproveSchema = z.object({
  incidentId: z.string().min(1),
  allianceId: z.string().min(1),
  payoutPlan: z.array(
    z.object({
      recipient: z.string().min(1),
      amount: z.number().int().positive(),
    }),
  ),
  insurerComment: z.string().min(1).max(2000),
});

export const policyProposalSchema = z.object({
  policyId: z.string().min(1),
  allianceId: z.string().min(1),
  reason: z.string().min(1).max(1000),
  changes: z.object({
    mode: z.enum(["ceasefire", "blockade", "wartime"]).optional(),
    tollBase: z.number().int().min(0).optional(),
    riskMultiplier: z.number().positive().optional(),
    civilianProtection: z.boolean().optional(),
    treatyExemptions: z.array(z.string()).optional(),
    redlist: z.array(z.string()).optional(),
    whitelist: z.array(z.string()).optional(),
  }),
});

export const policyApprovalSchema = z.object({
  proposalId: z.string().min(1),
  allianceId: z.string().min(1),
  approverComment: z.string().min(1).max(1000),
});

export const policyRollbackSchema = z.object({
  policyId: z.string().min(1),
  allianceId: z.string().min(1),
  targetVersion: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
});

export const writeRequestHeadersSchema = z.object({
  "idempotency-key": z.string().uuid(),
  "x-request-timestamp": z.coerce.number().int().positive(),
  "x-alliance-id": z.string().min(1).optional(),
  "x-actor-address": z.string().min(1).optional(),
  "x-role-bits": z.coerce.number().int().nonnegative().optional(),
});
