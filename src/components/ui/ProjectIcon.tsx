import { useState, useEffect } from "react";

type ProjectLike = {
  icon: string;
  iconColor: string;
  imagePath?: string | null;
  imageDataUrl?: string | null;
  updatedAt?: number;
};

export function ProjectIcon({ project, size = 36 }: { project: ProjectLike; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [project.imageDataUrl, project.imagePath, project.updatedAt]);

  if ((project.imageDataUrl || project.imagePath) && !imgFailed) {
    const v = project.updatedAt ?? 0;
    const src = project.imageDataUrl ?? `app://project-image/${project.imagePath}?v=${v}`;
    return (
      <img
        src={src}
        alt=""
        onError={() => setImgFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.22,
          objectFit: "cover",
          border: `1px solid ${project.iconColor}33`,
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
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
