import { ViewTransition } from "react";

// A template starts afresh on every move to another screen, unlike the layout, which stays put.
// That is what lets the screen leaving fade out while the one arriving fades in (styles in
// globals.css under "Moving between screens"). Typing in the search box or switching a tab on the
// same screen does not start a new template, so nothing animates there.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="screen-in" exit="screen-out" default="none">
      {children}
    </ViewTransition>
  );
}
