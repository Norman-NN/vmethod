/** Shared issue-estimate scale, including discovery and oversized-work sentinels. */
export const estimateScale = [0, 0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100, 999];

/** Refuse off-scale estimates before writing fields or freezing opening points. */
export function assertEstimate(value: unknown): asserts value is number {
  if (typeof value !== "number" || !estimateScale.includes(value)) {
    throw new Error(`Estimate must be one of: ${estimateScale.join(", ")}`);
  }
}
