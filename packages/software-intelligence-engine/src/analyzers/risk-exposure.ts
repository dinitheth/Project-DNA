import type { RiskNode } from '@project-dna/dna-core';

const SEVERITY_WEIGHTS: Record<RiskNode['severity'], number> = {
  info: 1,
  low: 2,
  medium: 4,
  high: 7,
  critical: 10,
};

const EXPOSURE_SCALE = 25;

export function calculateRiskExposureScore(risks: readonly RiskNode[]): number {
  const exposure = risks.reduce((total, risk) => {
    const affectedEntityCount = Math.max(1, new Set(risk.affectedEntities).size);
    return total + SEVERITY_WEIGHTS[risk.severity] * affectedEntityCount;
  }, 0);

  return Math.round(100 * (1 - Math.exp(-exposure / EXPOSURE_SCALE)));
}

export function compareRiskExposure(left: RiskNode, right: RiskNode): number {
  const severityDifference = SEVERITY_WEIGHTS[right.severity] - SEVERITY_WEIGHTS[left.severity];
  if (severityDifference !== 0) return severityDifference;

  const impactDifference =
    new Set(right.affectedEntities).size - new Set(left.affectedEntities).size;
  return impactDifference !== 0 ? impactDifference : left.id.localeCompare(right.id);
}
