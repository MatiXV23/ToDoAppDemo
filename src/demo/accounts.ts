import accounts from "./seed/accounts.json";

/** Cuentas de demo visibles en el login, una por rol. */
export type DemoAccount = {
  userId: string;
  email: string;
  password: string;
  role: string;
  description: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = accounts;
