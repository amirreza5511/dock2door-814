import { useLocalSearchParams, Stack } from 'expo-router';
import CompanyProfileScreen from '../employer/company-profile';

/**
 * Neutral company-profile route.
 *
 * Any role (worker, employer member, public) can land here. The underlying
 * `CompanyProfileScreen` accepts both `id` and `companyId` search params,
 * forces `effectiveMode = 'worker'` for non-members, and gates every internal
 * section (Trust & Verification, staff count, Recent Shifts, Manage Shifts,
 * Edit Company, operational stats) on `effectiveMode === 'private' && isMember`.
 *
 * We render the screen DIRECTLY so the URL stays neutral (`/company/:id`)
 * instead of bouncing to `/employer/company-profile`.
 */
export default function CompanyByIdRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {/* CompanyProfileScreen now reads either `companyId` or `id` from params */}
      <CompanyProfileScreen overrideCompanyId={id} />
    </>
  );
}
