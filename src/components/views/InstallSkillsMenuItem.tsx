import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { InstallSkillsModal } from "./InstallSkillsModal";
import { SkillsUpsellModal } from "./SkillsUpsellModal";
import { useLicense } from "~/queries";
import { isProTier } from "~/shared/license";

// Always-visible menu entry that opens the Install Skills modal. Unlike
// InstallSkillsButton, this never hides itself based on freshness — the user
// might want to reinstall over a current version.
export function InstallSkillsMenuItem({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { data: license } = useLicense();
  const isPro = !!license && isProTier(license);
  return (
    <>
      <Btn
        variant="ghost"
        icon="sparkles"
        onClick={() => {
          onOpen?.();
          if (isPro) setOpen(true);
          else setPaywallOpen(true);
        }}
        style={{ justifyContent: "flex-start" }}
        title="Install or reinstall AgentSystem skills into this project"
      >
        Install Skills
      </Btn>
      <InstallSkillsModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
      />
      <SkillsUpsellModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
      />
    </>
  );
}
