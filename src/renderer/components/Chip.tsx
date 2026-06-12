import type { ReactNode } from "react";

type ChipTone = "pass" | "warn" | "fail" | "neutral" | "accent";

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }): ReactNode {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function outcomeTone(outcome: string): ChipTone {
  switch (outcome) {
    case "pass":
    case "ok":
    case "succeeded":
    case "linked":
      return "pass";
    case "warn":
    case "new":
    case "running":
      return "warn";
    case "fail":
    case "error":
    case "failed":
    case "orphaned":
      return "fail";
    default:
      return "neutral";
  }
}
