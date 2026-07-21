import { create } from 'zustand';
import type { UserRole } from '@/constants/types';
import type { Domain } from '@/lib/access';

/**
 * Session-only "Explore mode": lets a visitor browse any role's real dashboards
 * with sample data — no account required. It is intentionally NOT persisted:
 * a fresh app launch always starts signed-out and non-exploring. Any real action
 * (post an order, submit a quote, accept, book, save, pay) is intercepted by the
 * action gate, which invites the visitor to create an account.
 */
interface ExploreState {
  /** True while the visitor is exploring a role dashboard without an account. */
  isExploring: boolean;
  /** The role whose dashboard is currently being previewed. */
  exploreRole: UserRole | null;
  /** The domain the previewed role belongs to. */
  exploreDomain: Domain | null;

  /** Action-gate modal: the label of the blocked action, or null when hidden. */
  gateAction: string | null;

  /** Enter explore mode as a given role/domain. */
  startExplore: (role: UserRole, domain: Domain) => void;
  /** Leave explore mode entirely. */
  stopExplore: () => void;
  /** Intercept a real action — opens the "create an account" gate. */
  requestAction: (label: string) => void;
  /** Dismiss the action gate. */
  dismissGate: () => void;
}

export const useExploreStore = create<ExploreState>()((set) => ({
  isExploring: false,
  exploreRole: null,
  exploreDomain: null,
  gateAction: null,

  startExplore: (role, domain) => {
    set({ isExploring: true, exploreRole: role, exploreDomain: domain, gateAction: null });
  },
  stopExplore: () => {
    set({ isExploring: false, exploreRole: null, exploreDomain: null, gateAction: null });
  },
  requestAction: (label) => {
    set({ gateAction: label });
  },
  dismissGate: () => {
    set({ gateAction: null });
  },
}));

/**
 * Returns a guard function. In explore mode it intercepts the real action and
 * opens the account gate (returns false = "don't run the real action"); when not
 * exploring it simply returns true so the caller runs the action normally.
 *
 * Usage:
 *   const guard = useActionGuard();
 *   onPress={() => { if (guard('Post this load')) { doRealThing(); } }}
 */
export function useActionGuard(): (label: string) => boolean {
  const isExploring = useExploreStore((s) => s.isExploring);
  const requestAction = useExploreStore((s) => s.requestAction);
  return (label: string) => {
    if (isExploring) {
      requestAction(label);
      return false;
    }
    return true;
  };
}
