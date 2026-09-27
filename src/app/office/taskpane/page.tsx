import type { Metadata } from "next";
import { Taskpane } from "@/components/office/Taskpane";

export const metadata: Metadata = { title: "YouBank for Excel and PowerPoint", robots: { index: false } };

/** The add-in's task pane, opened by the YouBank button in Excel and PowerPoint. */
export default function OfficeTaskpanePage() {
  return <Taskpane />;
}
