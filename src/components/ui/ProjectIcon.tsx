type ProjectLike = { icon: string; iconColor: string };

export function ProjectIcon({ project, size = 36 }: { project: ProjectLike; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: `linear-gradient(135deg, ${project.iconColor}22, ${project.iconColor}08)`,
        border: `1px solid ${project.iconColor}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontSize: size * 0.36,
        fontWeight: 600,
        color: project.iconColor,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {project.icon}
    </div>
  );
}
