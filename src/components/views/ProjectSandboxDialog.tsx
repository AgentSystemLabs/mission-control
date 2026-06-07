import { useEffect, useId, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";
import type { Project } from "~/db/schema";
import { DEFAULT_BRANCH } from "~/shared/domain";
import type { SandboxImageStrategy } from "~/shared/sandbox";

const MAX_BOOT_COMMAND_LENGTH = 5_000;
const MAX_INIT_COMMAND_LENGTH = 500;

const IMAGE_STRATEGY_OPTIONS: {
  value: SandboxImageStrategy;
  title: string;
  desc: string;
}[] = [
  {
    value: "golden",
    title: "Pre-built image",
    desc: "Boots in ~1 min from our maintained AMI with all tools preinstalled.",
  },
  {
    value: "full-install",
    title: "Setup script",
    desc: "Installs everything at boot on a clean Ubuntu image (~3–6 min).",
  },
];

export type ProjectSandboxCreateInput = {
  name: string;
  baseBranch: string;
  bootCommand: string;
  initCommand: string;
  copyEnvFiles: boolean;
  imageStrategy: SandboxImageStrategy;
};

function defaultSandboxName(project: Project | null): string {
  return project ? `${project.name} sandbox` : "Project sandbox";
}

function defaultInitCommand(project: Project | null): string {
  return project?.worktreeSetupCommand?.trim() || "npm i";
}

export function ProjectSandboxDialog({
  open,
  project,
  remote,
  busy,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  project: Project | null;
  /** Detected git origin to clone from, or null when the project has none. */
  remote: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: ProjectSandboxCreateInput) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState(DEFAULT_BRANCH);
  const [bootCommand, setBootCommand] = useState("");
  const [initCommand, setInitCommand] = useState("");
  const [copyEnvFiles, setCopyEnvFiles] = useState(true);
  const [imageStrategy, setImageStrategy] = useState<SandboxImageStrategy>("golden");
  const bootId = useId();
  const imageStrategyName = useId();

  useEffect(() => {
    if (!open) return;
    setName(defaultSandboxName(project));
    setBaseBranch(project?.branch?.trim() || DEFAULT_BRANCH);
    setBootCommand("");
    setInitCommand(defaultInitCommand(project));
    setCopyEnvFiles(true);
    setImageStrategy("golden");
  }, [open, project?.id]);

  const missingRemote = !remote;
  const bootTooLong = bootCommand.length > MAX_BOOT_COMMAND_LENGTH;
  const initTooLong = initCommand.length > MAX_INIT_COMMAND_LENGTH;
  const canCreate =
    !!name.trim() && !!baseBranch.trim() && !!remote && !bootTooLong && !initTooLong && !busy;

  const submit = async () => {
    if (!canCreate) return;
    await onCreate({
      name: name.trim(),
      baseBranch: baseBranch.trim(),
      bootCommand: bootCommand.trim(),
      initCommand: initCommand.trim(),
      copyEnvFiles,
      imageStrategy,
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Create project sandbox"
      width={560}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" icon="terminal" onClick={() => void submit()} disabled={!canCreate}>
            {busy ? "Creating..." : "Create sandbox"}
          </Btn>
        </>
      }
    >
      <div
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          const target = event.target as HTMLElement;
          if (target.closest("textarea, button")) return;
          event.preventDefault();
          void submit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
          <TextField
            label="Sandbox name"
            value={name}
            onChange={setName}
            placeholder={defaultSandboxName(project)}
            autoFocus
          />
          <TextField
            label="Base branch"
            value={baseBranch}
            onChange={setBaseBranch}
            placeholder="main"
            mono
          />
        </div>

        {missingRemote ? (
          <div
            role="alert"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "10px 12px",
              background: "var(--surface-0)",
              border: "1px solid var(--status-failed)",
              borderRadius: 7,
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--status-failed)" }}>
              No git “origin” remote found
            </span>
            <span style={{ color: "var(--text-dim)" }}>
              Mission Control clones this project from its <code>origin</code> remote using your
              SSH keys, so it needs one before it can build a sandbox. Add a remote, then reopen
              this dialog:
            </span>
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {"git remote add origin <url>"}
            </code>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "9px 12px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--text-dim)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Clones from
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--text)",
                wordBreak: "break-word",
              }}
            >
              {remote}
            </span>
          </div>
        )}

        <fieldset
          style={{
            border: 0,
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <legend
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              padding: 0,
            }}
          >
            Provisioning
          </legend>
          {/* Native radios sharing a name + the fieldset/legend already form a
              labeled group; no role/aria-label needed (matches the sibling cards). */}
          <div style={{ display: "flex", gap: 8 }}>
            {IMAGE_STRATEGY_OPTIONS.map((opt) => {
              const selected = imageStrategy === opt.value;
              return (
                <label
                  key={opt.value}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    padding: "10px 12px",
                    background: "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 7,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name={imageStrategyName}
                    value={opt.value}
                    checked={selected}
                    disabled={busy}
                    onChange={() => setImageStrategy(opt.value)}
                    style={{ marginTop: 2, accentColor: "var(--accent)" }}
                  />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{opt.title}</span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                        lineHeight: 1.45,
                      }}
                    >
                      {opt.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={copyEnvFiles}
            disabled={busy}
            onChange={(event) => setCopyEnvFiles(event.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--accent)" }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Copy root .env files</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>
              Copies .env and .env.* from the current project after clone.
            </span>
          </span>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            htmlFor={bootId}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Sandbox boot command
          </label>
          <textarea
            id={bootId}
            value={bootCommand}
            onChange={(event) => setBootCommand(event.target.value)}
            placeholder="sudo apt-get update && sudo apt-get install -y postgresql-client"
            rows={4}
            spellCheck={false}
            disabled={busy}
            aria-invalid={bootTooLong}
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              padding: "9px 12px",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: bootTooLong ? "var(--status-failed)" : "var(--text-faint)",
            }}
          >
            Optional. {bootCommand.length}/{MAX_BOOT_COMMAND_LENGTH}
          </span>
        </div>

        <TextField
          mono
          label="Project init command"
          value={initCommand}
          onChange={(value) => setInitCommand(value.slice(0, MAX_INIT_COMMAND_LENGTH + 1))}
          placeholder="npm i"
          hint={`${initCommand.length}/${MAX_INIT_COMMAND_LENGTH}`}
          ariaInvalid={initTooLong}
        />

        {error && (
          <p role="alert" style={{ color: "var(--status-failed)", fontSize: 12, margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
