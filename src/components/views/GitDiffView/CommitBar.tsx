import { useCallback, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import {
  useGenerateCommitMessage,
  useGitCommit,
  useGitPush,
} from "~/queries/git";

export function CommitBar({
  projectId,
  stagedCount,
}: {
  projectId: string;
  stagedCount: number;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  const generate = useGenerateCommitMessage(projectId);
  const commitM = useGitCommit(projectId);
  const pushM = useGitPush(projectId);

  const onGenerate = useCallback(async () => {
    setError(null);
    setPushNotice(null);
    try {
      const r = await generate.mutateAsync();
      setMessage(r.message);
    } catch (e: any) {
      setError(e?.message || "Failed to generate commit message");
    }
  }, [generate]);

  const onCommit = useCallback(async () => {
    setError(null);
    setPushNotice(null);
    let msg = message.trim();
    try {
      if (!msg) {
        const r = await generate.mutateAsync();
        msg = r.message.trim();
        setMessage(r.message);
      }
      if (!msg) {
        setError("Commit message is empty");
        return;
      }
      await commitM.mutateAsync(msg);
      setMessage("");
    } catch (e: any) {
      setError(e?.message || "Commit failed");
    }
  }, [message, generate, commitM]);

  const onPush = useCallback(async () => {
    setError(null);
    setPushNotice(null);
    try {
      const r = await pushM.mutateAsync();
      setPushNotice(
        r.setUpstream
          ? "Pushed and set upstream."
          : "Pushed.",
      );
    } catch (e: any) {
      setError(e?.message || "Push failed");
    }
  }, [pushM]);

  const generating = generate.isPending;
  const committing = commitM.isPending;
  const pushing = pushM.isPending;
  const commitDisabled = stagedCount === 0 || committing;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: 12,
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ position: "relative" }}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            stagedCount === 0
              ? "Stage files to enable commit"
              : "Commit message (or click Generate)"
          }
          rows={3}
          spellCheck={false}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 60,
            maxHeight: 200,
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            lineHeight: 1.45,
            padding: "8px 10px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
      {error && (
        <div
          style={{
            color: "var(--status-failed)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
      {pushNotice && !error && (
        <div
          style={{
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          {pushNotice}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn
          variant="ghost"
          size="sm"
          icon="sparkles"
          onClick={onGenerate}
          disabled={stagedCount === 0 || generating}
          title="Generate commit message from staged diff"
        >
          {generating ? "Generating…" : "Generate"}
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn
          variant="ghost"
          size="sm"
          icon="upload"
          onClick={onPush}
          disabled={pushing}
          title="Push current branch"
        >
          {pushing ? "Pushing…" : "Push"}
        </Btn>
        <Btn
          variant="primary"
          size="sm"
          icon="check"
          onClick={onCommit}
          disabled={commitDisabled}
          title={
            stagedCount === 0
              ? "Stage files first"
              : "Commit staged files"
          }
        >
          {committing ? (
            <>
              <Icon name="refresh" size={11} /> Committing…
            </>
          ) : (
            `Commit ${stagedCount}`
          )}
        </Btn>
      </div>
    </div>
  );
}
