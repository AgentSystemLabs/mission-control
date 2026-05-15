import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { Btn } from "./Btn";
import { StaticHotkeyTooltip } from "./Tooltip";
import type { IconName } from "./Icon";
import { useHotkey } from "~/lib/use-hotkey";

type ConfirmVariant = "danger" | "primary";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  icon?: IconName;
  loading?: boolean;
  width?: number;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  icon,
  loading = false,
  width,
}: ConfirmDialogProps) {
  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onConfirm();
    },
    { enabled: open && !loading }
  );

  useHotkey(
    "enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onConfirm();
    },
    { enabled: open && !loading }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={width}
      footer={
        <>
          <StaticHotkeyTooltip hotkey="Esc">
            <Btn variant="ghost" onClick={onClose} disabled={loading}>
              {cancelLabel}
            </Btn>
          </StaticHotkeyTooltip>
          <StaticHotkeyTooltip hotkey="⌘ Enter">
            <Btn
              variant={variant}
              icon={icon}
              onClick={() => void onConfirm()}
              disabled={loading}
            >
              {loading ? `${confirmLabel}…` : confirmLabel}
            </Btn>
          </StaticHotkeyTooltip>
        </>
      }
    >
      {children}
    </Modal>
  );
}
