import { useLocalSearchParams, Redirect } from 'expo-router';

/**
 * Neutral company-profile route.
 * Any role (worker, employer, public) can land here.
 * The underlying screen forces Worker View for non-members,
 * so private company data is never exposed via this route.
 */
export default function CompanyByIdRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/" />;
  return (
    <Redirect
      href={{ pathname: '/employer/company-profile' as any, params: { companyId: id } }}
    />
  );
}
