"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { demoStepAction, removeDemoAction } from "../actions";

type Note = { kind: "ok" | "error"; text: string };

/**
 * The two buttons of the demo page. Adding runs the steps one after another (one request may only make so many
 * calls to the database); a step that stopped can simply be run again by pressing the button again.
 */
export function DemoPanel({ steps, people, posts, complete }: { steps: number; people: number; posts: number; complete: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"adding" | "removing" | null>(null);
  const [progress, setProgress] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  async function add() {
    setNote(null);
    setBusy("adding");
    let base = Date.now();
    for (let step = 0; step < steps; step++) {
      setProgress(`Working on step ${step + 1} of ${steps}. Keep this page open.`);
      const result = await demoStepAction(step, base).catch(() => null);
      if (!result) {
        setBusy(null);
        setProgress("");
        return setNote({ kind: "error", text: "The connection dropped. Nothing is lost: press the button again to carry on." });
      }
      if (!result.ok) {
        setBusy(null);
        setProgress("");
        return setNote({ kind: "error", text: result.message });
      }
      base = result.base;
    }
    setBusy(null);
    setProgress("");
    setNote({ kind: "ok", text: "Done. The demo people and posts are on the site." });
    router.refresh();
  }

  async function remove() {
    setAsking(false);
    setNote(null);
    setBusy("removing");
    setProgress("Removing the demo people and everything they made.");
    const result = await removeDemoAction().catch(() => null);
    setBusy(null);
    setProgress("");
    if (result?.ok) {
      setNote({ kind: "ok", text: `Removed ${result.removed.people} people, ${result.removed.posts} posts and ${result.removed.pictures} pictures.` });
      router.refresh();
    } else {
      setNote({ kind: "error", text: result ? result.message : "The connection dropped. Press the button again to check." });
    }
  }

  return (
    <div className="hq-demo">
      <div className="hq-confirm">
        <button type="button" className="btn btn-primary" disabled={busy !== null || complete} onClick={add}>
          {people === 0 ? "Add demo people" : complete ? "Demo people are added" : "Finish adding demo people"}
        </button>
        {asking ? (
          <span className="hq-confirm" role="group" aria-label="Remove the demo data">
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={remove}>
              Yes, remove them
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost" disabled={busy !== null || (people === 0 && posts === 0)} onClick={() => setAsking(true)}>
            Remove demo data
          </button>
        )}
      </div>
      <p className={note?.kind === "error" ? "error" : "hint"} role={progress || note ? (note?.kind === "error" ? "alert" : "status") : undefined}>
        {progress || note?.text || ""}
      </p>
    </div>
  );
}
