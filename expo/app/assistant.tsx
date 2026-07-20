import { Redirect } from 'expo-router';

/**
 * The standalone Q&A assistant has been merged into the AI Copilot —
 * one entry point for chat, actions, memory and human handoff.
 */
export default function AssistantScreen() {
  return <Redirect href="/copilot" />;
}
