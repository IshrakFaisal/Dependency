import type { RiskSignal, RiskStatus } from "@/lib/types";

export interface RiskAssessment {
  score: number;
  status: RiskStatus;
}

/** A transparent demo rubric, not a probability that a package is malicious. */
export function calculateRiskScore(signals: readonly RiskSignal[]): number {
  const ids = new Set<string>();
  let score = 0;

  for (const signal of signals) {
    if (ids.has(signal.id)) {
      throw new Error(`Duplicate risk signal: ${signal.id}`);
    }
    if (
      !Number.isFinite(signal.points) ||
      signal.points < 0 ||
      signal.points > 100
    ) {
      throw new Error("Risk points must be finite numbers between 0 and 100.");
    }
    if (signal.evidenceIds.length === 0) {
      throw new Error(`Risk signal requires evidence: ${signal.id}`);
    }
    ids.add(signal.id);
    score += signal.points;
  }

  return Math.min(100, Math.round(score));
}

export function getRiskStatus(
  score: number,
  sufficientEvidence = true,
): RiskStatus {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Risk score must be a finite number between 0 and 100.");
  }
  if (!sufficientEvidence) return "INCONCLUSIVE";
  if (score >= 60) return "HIGH RISK";
  if (score >= 25) return "REVIEW RECOMMENDED";
  return "LOW RISK";
}

export function assessRisk(
  signals: readonly RiskSignal[],
  sufficientEvidence = true,
): RiskAssessment {
  const score = calculateRiskScore(signals);
  return { score, status: getRiskStatus(score, sufficientEvidence) };
}
