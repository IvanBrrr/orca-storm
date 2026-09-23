/** Checks the object shape before reading fields from a Plane API response. */
export function isPlaneJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
