import { z } from "zod";
import type { Tx } from "@/lib/db";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, SERVICE_KEYS, type ScoringWeights, type ServiceKey } from "@/lib/domain";

export type Settings = {
  weights: ScoringWeights;
  thresholds: { high: number; medium: number };
  enabledServices: ServiceKey[];
  aiDailyLimit: number;
  defaultCountry: string;
  defaultProvider: "osm" | "google_places";
  senderName: string | null;
  senderPitch: string | null;
};

export const settingsInput = z
  .object({
    weights: z.object({
      digital: z.number().min(0).max(100),
      fit: z.number().min(0).max(100),
      accessibility: z.number().min(0).max(100),
      evidence: z.number().min(0).max(100),
    }),
    thresholds: z.object({ high: z.number().int().min(1).max(100), medium: z.number().int().min(1).max(100) }),
    enabledServices: z.array(z.enum(SERVICE_KEYS)).min(1, "Activa al menos un servicio."),
    aiDailyLimit: z.number().int().min(0).max(1000),
    defaultProvider: z.enum(["osm", "google_places"]),
    senderName: z.string().trim().max(120).nullable(),
    senderPitch: z.string().trim().max(1500).nullable(),
  })
  .refine((v) => Math.round(v.weights.digital + v.weights.fit + v.weights.accessibility + v.weights.evidence) === 100, {
    message: "Las ponderaciones deben sumar 100.",
    path: ["weights"],
  })
  .refine((v) => v.thresholds.medium < v.thresholds.high, { message: "El umbral de prioridad media debe ser inferior al de prioridad alta.", path: ["thresholds"] });

export type SettingsInput = z.infer<typeof settingsInput>;

export async function getSettings(tx: Tx, workspaceId: string): Promise<Settings> {
  const [r] = await tx<Record<string, unknown>[]>`select * from workspace_settings where workspace_id = ${workspaceId}`;
  if (!r) return { weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, enabledServices: [...SERVICE_KEYS], aiDailyLimit: 30, defaultCountry: "ES", defaultProvider: "osm", senderName: null, senderPitch: null };
  return {
    weights: r.scoring_weights as ScoringWeights,
    thresholds: r.priority_thresholds as { high: number; medium: number },
    enabledServices: r.enabled_services as ServiceKey[],
    aiDailyLimit: Number(r.ai_daily_limit),
    defaultCountry: String(r.default_country),
    defaultProvider: r.default_provider as Settings["defaultProvider"],
    senderName: (r.sender_name as string) ?? null,
    senderPitch: (r.sender_pitch as string) ?? null,
  };
}

export async function saveSettings(tx: Tx, workspaceId: string, v: SettingsInput): Promise<void> {
  await tx`update workspace_settings set
    scoring_weights = ${tx.json(v.weights)}, priority_thresholds = ${tx.json(v.thresholds)},
    enabled_services = ${v.enabledServices as unknown as string[]}, ai_daily_limit = ${v.aiDailyLimit},
    default_provider = ${v.defaultProvider}, sender_name = ${v.senderName}, sender_pitch = ${v.senderPitch}
    where workspace_id = ${workspaceId}`;
}
