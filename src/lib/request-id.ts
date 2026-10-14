// Request ids (ARCH-04): every request gets one, in the proxy, so a log line, an
// error toast and a response header can be matched. No Node-only imports.

export const REQUEST_ID_HEADER = "x-request-id";

/** An id a caller (a reverse proxy) may supply: short and plain, so it can't smuggle anything into logs. */
const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export const newRequestId = () => crypto.randomUUID();

/** The supplied id when it is acceptable, else null. */
export const acceptRequestId = (value: string | null | undefined) => (value && VALID.test(value) ? value : null);

/** What to show a person who needs to quote it: the first block of the uuid. */
export const shortRequestId = (id: string) => id.slice(0, 8);
