import { Modal } from "~/components/ui/Modal";
import { RecallPanel, type RecallFilter } from "~/components/views/RecallPanel";

export function RecallModal({
  open,
  onClose,
  projectId,
  projectName,
  initialFilter = "all",
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  initialFilter?: RecallFilter;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Recall — ${projectName}`}
      width={620}
      maxHeight="88vh"
      contentStyle={{ padding: "12px 18px 18px" }}
    >
      <RecallPanel projectId={projectId} initialFilter={initialFilter} />
    </Modal>
  );
}
