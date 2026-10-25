/** A subscription whose end-of-period message never reached us is trusted for this long past its period, then stops. */
export const ACCESS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
