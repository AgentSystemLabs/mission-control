import { useRouter } from "@tanstack/react-router";
import { Icon } from "~/components/ui/Icon";
import type { Project } from "~/db/schema";

export function OpenProjectButton({ project }: { project: Project }) {
  const router = useRouter();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void router.navigate({ to: "/projects/$id", params: { id: project.id } });
      }}
      style={{
        background: "transparent",
        border: 0,
        padding: 4,
        color: "var(--text-faint)",
        cursor: "pointer",
        display: "flex",
      }}
      title={`Open ${project.name}`}
      aria-label={`Open project ${project.name}`}
    >
      <Icon name="folder" size={11} />
    </button>
  );
}
