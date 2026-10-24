"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { REPORT_CATEGORIES, REPORT_NOTE_MAX } from "@/lib/report-categories";
import { Icon } from "../../_components/icon";
import { fileReportAction } from "../actions";

/** The report form: pick what is wrong, add a few words if you like, send. Shows the case number when it is done. */
export function ReportForm({ postId }: { postId: string }) {
  const [category, setCategory] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ caseId: string; already: boolean } | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <section className="report-done" aria-live="polite">
        <Icon name="check-circle" size={32} />
        <h2>{done.already ? "You already reported this" : "Thank you. We have your report."}</h2>
        <p>
          Your case number is <strong className="case-id">{done.caseId}</strong>.
          {done.already ? " It is still being looked at." : " The people who look after this space will read it."}
        </p>
        <p className="hint">The person who wrote the post is not told that you reported it.</p>
        <div className="report-done-actions">
          <Link className="btn btn-primary" href="/reports">
            See your reports
          </Link>
          <Link className="btn btn-ghost" href="/">
            Back to Home
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form
      className="report-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!category) {
          setError("Choose what is wrong with the post.");
          return;
        }
        start(async () => {
          const result = await fileReportAction(postId, category, note);
          if (result.ok) setDone({ caseId: result.caseId, already: result.already });
          else setError(result.message);
        });
      }}
    >
      <fieldset className="report-options">
        <legend>What is wrong with this post?</legend>
        {REPORT_CATEGORIES.map((c) => (
          <label key={c.id} className="report-option">
            <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => setCategory(c.id)} />
            <span className="report-option-text">
              <span className="report-option-title">{c.label}</span>
              <span className="report-option-hint">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="report-note">{category === "other" ? "What is wrong?" : "Anything else we should know? (optional)"}</label>
        <textarea
          id="report-note"
          className="textarea"
          rows={4}
          maxLength={REPORT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-describedby="report-note-hint"
        />
        <p id="report-note-hint" className="hint">
          {note.length} of {REPORT_NOTE_MAX}. The people who look after this space can see who sent the report. The person who wrote the post cannot.
        </p>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "Sending" : "Send report"}
      </button>
    </form>
  );
}
