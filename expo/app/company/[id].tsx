import { useLocalSearchParams, Redirect } from 'expo-router';
import CompanyProfileScreen from '../employer/company-profile';

/**
 * Neutral company-profile route.
 * Any role (worker, employer, public) can land here.
 *
 * We render the existing CompanyProfileScreen directly (no redirect) so the
 * URL stays neutral (`/company/:id`) instead of bouncing to an employer-scoped
 * URL. The underlying screen forces Worker View for non-members
 * (`effectiveMode = isMember ? viewMode : 'worker'`), and internal sections
 * (Trust & Verification, staff count, Recent Shifts, Manage Shifts, Edit
 * Company, pending-rating CTA) are gated on `effectiveMode === 'private' && isMember`,
 * so private company data is never exposed via this route.
 */
export default function CompanyByIdRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/" />;
  return <CompanyProfileScreen />;
}
