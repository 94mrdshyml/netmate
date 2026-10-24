// Stripe-style ids: a short prefix naming the thing, an underscore, then 24
// random base62 characters (about 143 bits). Example: usr_3kT9xQ0mYb7LpA2vNc8RzEd1.
// The prefix table is in docs/PRD.md section 10. Add a prefix here in the same
// change that adds a table.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALPHABET_SIZE = ALPHABET.length; // 62

export const ID_LENGTH = 24;

/** Model name -> prefix. Better Auth models use its own names (user, session, account, verification). */
export const ID_PREFIXES = {
  user: "usr",
  session: "sess",
  account: "acc",
  verification: "ver",
  inviteLink: "inv",
  inviteUse: "invu",
  post: "post",
  notification: "ntf",
  report: "rpt",
  reportEvent: "rpe",
  subscription: "sub",
  subscriptionPayment: "spay",
} as const;

export type IdModel = keyof typeof ID_PREFIXES;

/** Random base62 string. Rejection sampling keeps every character equally likely. */
export function randomId(length: number = ID_LENGTH): string {
  // 248 = 4 * 62, the largest multiple of 62 that fits in a byte.
  const limit = 248;
  let out = "";
  while (out.length < length) {
    // getRandomValues accepts at most 65,536 bytes per call.
    const bytes = crypto.getRandomValues(new Uint8Array(Math.min((length - out.length) * 2, 65_536)));
    for (const byte of bytes) {
      if (byte < limit) {
        out += ALPHABET[byte % ALPHABET_SIZE];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function isIdModel(model: string): model is IdModel {
  return Object.hasOwn(ID_PREFIXES, model);
}

export function newId(model: IdModel): string {
  return `${ID_PREFIXES[model]}_${randomId()}`;
}

/** True if `value` is a well-formed id for `model`. */
export function isId(model: IdModel, value: unknown): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${ID_PREFIXES[model]}_[0-9A-Za-z]{${ID_LENGTH}}$`).test(value)
  );
}
