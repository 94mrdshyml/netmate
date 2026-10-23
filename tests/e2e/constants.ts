// Fixed values for the e2e preview. Only used against a throwaway local database.
export const E2E = {
  port: 8788,
  persistDir: ".wrangler/e2e-state",
  setupToken: "e2e-setup-token-0123456789-abcdefghijkl",
  authSecret: "e2e-auth-secret-0123456789-abcdefghijklmnop",
  encryptionKey: "e2e-encryption-key-0123456789-abcdefghijk",
  authFile: "tests/e2e/.auth/admin.json",
  admin: {
    firstName: "Riya",
    lastName: "Sen",
    email: "riya@example.com",
    username: "riya_sen",
    password: "correct horse battery",
  },
  instance: { name: "E2E Valley", primary: "#0B6E4F" },
} as const;
