export type HostedSessionSummary = {
  hostedEnabled: boolean;
  authenticated: boolean;
  user: null | {
    id: string;
    academyUserId: string;
    email: string;
  };
  academyLoginUrl: string;
  academyAccountUrl: string;
  academyLogoutUrl: string;
};

export function createElectronLocalSessionSummary(): HostedSessionSummary {
  return {
    hostedEnabled: false,
    authenticated: true,
    user: null,
    academyLoginUrl: "",
    academyAccountUrl: "",
    academyLogoutUrl: "",
  };
}
