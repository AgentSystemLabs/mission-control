export type HostedAuthSummary = {
  enabled: boolean;
  userId: string | null;
  organizationId: string | null;
};

export type RemoteRuntimeEntitlement = {
  allowed: boolean;
  reason: "auth-required" | "subscription-required" | "account-blocked" | null;
  plan: "none" | "trial" | "paid";
  trialEndsAt: string | null;
};

export type Entitlements = {
  hosted: HostedAuthSummary;
  remoteRuntime: RemoteRuntimeEntitlement;
};
