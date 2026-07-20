import { redirect } from "next/navigation";

/**
 * The standalone Q&A assistant has been merged into the AI Copilot —
 * one entry point for chat, actions, memory and human handoff.
 */
export default function AssistantPage() {
  redirect("/copilot");
}
