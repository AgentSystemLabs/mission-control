import type { CSSProperties, ReactElement, ReactNode } from "react";
import { toast, type ExternalToast, type ToastClassnames } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";

export const MC_TOAST_CLOSE_BTN_CLASS =
  "mc-btn mc-btn-ghost mc-btn-sm mc-toast-close-btn";

export const MC_TOAST_CUSTOM_SHELL = "mc-toast-custom-shell";

const MC_TOAST_CUSTOM_CLASS_NAMES = {
  toast: MC_TOAST_CUSTOM_SHELL,
  default: MC_TOAST_CUSTOM_SHELL,
  info: MC_TOAST_CUSTOM_SHELL,
  warning: MC_TOAST_CUSTOM_SHELL,
  loading: MC_TOAST_CUSTOM_SHELL,
  success: MC_TOAST_CUSTOM_SHELL,
  error: MC_TOAST_CUSTOM_SHELL,
} satisfies ToastClassnames;

export const MC_TOAST_CLOSE_ICON = (
  <span className="mc-btn-content">
    <Icon name="x" size={12} />
  </span>
);

export const MC_TOAST_CLASS_NAMES = {
  default: "mc-toast-panel",
  info: "mc-toast-panel",
  warning: "mc-toast-panel mc-toast-warning",
  loading: "mc-toast-panel mc-toast-loading",
  success: "mc-toast-panel mc-toast-success",
  error: "mc-toast-panel mc-toast-error",
  closeButton: MC_TOAST_CLOSE_BTN_CLASS,
} satisfies ToastClassnames;

export const MC_TOAST_OPTS = {
  closeButton: true,
  dismissible: true,
} satisfies Pick<ExternalToast, "closeButton" | "dismissible">;

function McToastSpinner() {
  return (
    <div className="sonner-loading-wrapper" data-visible="true">
      <div className="sonner-spinner">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="sonner-loading-bar" />
        ))}
      </div>
    </div>
  );
}

/** Loading toast with spinner + close button. Sonner's toast.loading() hides close. */
export function mcToastLoading(message: string, options?: ExternalToast): string | number {
  const { classNames, ...rest } = options ?? {};
  return toast(message, {
    ...MC_TOAST_OPTS,
    duration: Infinity,
    icon: <McToastSpinner />,
    classNames: {
      ...classNames,
      toast: ["mc-toast-panel", "mc-toast-loading", classNames?.toast].filter(Boolean).join(" "),
    },
    ...rest,
  });
}

export function McToastActions({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="mc-toast-actions" style={style}>
      {children}
    </div>
  );
}

export function McToastCloseButton({
  toastId,
  style,
}: {
  toastId: string | number;
  style?: CSSProperties;
}) {
  return (
    <Btn
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Close"
      className="mc-toast-close-btn"
      style={style}
      onClick={() => toast.dismiss(toastId)}
      icon="x"
    />
  );
}

export function mcToastCustom(
  render: (toastId: string | number) => ReactElement,
  options?: ExternalToast,
): string | number {
  const { classNames, ...rest } = options ?? {};
  return toast.custom((toastId) => render(toastId), {
    ...MC_TOAST_OPTS,
    classNames: { ...MC_TOAST_CUSTOM_CLASS_NAMES, ...classNames },
    ...rest,
  });
}
