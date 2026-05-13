import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import type { MissingCli } from "./types";

export function MissingCliDialog({
  open,
  missingCli,
  onClose,
}: {
  open: boolean;
  missingCli: MissingCli | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="CLI not detected"
      width={440}
      footer={
        <Btn variant="primary" onClick={onClose}>
          OK
        </Btn>
      }
    >
      {missingCli && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
            Mission Control could not find{" "}
            <code style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>
              {missingCli.cmd}
            </code>{" "}
            for {missingCli.label}.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-dim)" }}>
            Install the ship skill, then make sure{" "}
            <code style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>
              {missingCli.cmd}
            </code>{" "}
            is available on your PATH before starting this session.
          </p>
        </div>
      )}
    </Modal>
  );
}
