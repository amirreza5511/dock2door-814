-- =============================================================================
-- DOCK2DOOR — LIVE VERIFICATION CHECKLIST
-- Run these queries in the Supabase SQL editor AFTER applying migrations 0056 and 0057.
-- Expected results are listed as comments next to each query.
-- =============================================================================

-- =============================================================================
-- SECTION 1: Migration 0056 — SuperAdmin admin role + certification approval
-- =============================================================================

-- 1.1 Confirm is_admin() returns true for the SuperAdmin user.
--     Replace 'your-superadmin-email@example.com' with the actual email.
SELECT
  p.email,
  p.role AS profile_role,
  ur.role AS user_roles_entry,
  public.is_admin() AS is_admin_result
FROM profiles p
LEFT JOIN user_roles ur ON ur.user_id = p.id
WHERE p.email = 'your-superadmin-email@example.com';
-- EXPECTED: is_admin_result = true  (requires calling this via a DB connection
--           authenticated as that user, or via: SET LOCAL "request.jwt.claims" = ...)

-- 1.2 List all users with admin role entries in user_roles.
SELECT p.email, p.role AS profile_role, ur.role AS platform_role
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
ORDER BY ur.role, p.email;
-- EXPECTED: At least one row with platform_role = 'admin' or 'superadmin'

-- 1.3 Run the admin role audit function (migration 0056 adds this).
SELECT * FROM public.admin_role_audit();
-- EXPECTED: is_admin_result = true for each admin/superadmin user.
--           If the function does not exist, migration 0056 has not been applied.

-- 1.4 Confirm SuperAdmin can see pending worker_certifications.
--     Run AS the SuperAdmin user (set auth.uid() in the jwt claims or use service role).
SELECT id, worker_user_id, type, status
FROM worker_certifications
WHERE status = 'Pending'
ORDER BY created_at DESC
LIMIT 10;
-- EXPECTED: rows returned (if any certs are pending).
--           If 0 rows but certs exist, the RLS policy for is_admin() is not applied.

-- 1.5 Confirm admin_approve_certification RPC exists and is callable.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('admin_approve_certification', 'admin_reject_certification', 'admin_role_audit');
-- EXPECTED: 3 rows returned.

-- =============================================================================
-- SECTION 2: Migration 0057 — Profile security field lockdown
-- =============================================================================

-- 2.1 Confirm that normal users CANNOT update their own role, status, or company_id.
--     The migration should have added RLS WITH CHECK constraints or a trigger.
--     Test by running this as a normal (non-admin) authenticated user:
--
--     UPDATE profiles SET role = 'Admin' WHERE id = auth.uid();
--     → EXPECTED: ERROR (permission denied or check violation)
--
--     UPDATE profiles SET status = 'Active' WHERE id = auth.uid();
--     → EXPECTED: ERROR or silently ignored (column blocked by trigger/policy)

-- 2.2 Confirm the trigger or policy exists.
SELECT trigger_name, event_object_table, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'profiles'
  AND trigger_name LIKE '%security%' OR trigger_name LIKE '%lock%' OR trigger_name LIKE '%guard%';
-- OR check for an RLS policy that blocks role/status changes:
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
-- EXPECTED: A WITH CHECK policy that prevents ordinary users from modifying role/status/company_id.

-- 2.3 Confirm dock.updateUser in trpc.ts CANNOT set role or status.
--     This is a code-level check — verify trpc.ts dock.updateUser procedure only allows:
--       - name
--       - profile_image
--     and explicitly EXCLUDES: role, status, company_id
-- File: expo/lib/trpc.ts, procedure 'dock.updateUser'
-- EXPECTED: no `role` or `status` key in the db object (verified from code review).

-- =============================================================================
-- SECTION 3: RLS Tests — Role-by-role verification
-- =============================================================================

-- 3.1 Worker: can only see their own certifications
-- Run AS worker user (uid = WORKER_UID):
SELECT id, status FROM worker_certifications WHERE worker_user_id != auth.uid();
-- EXPECTED: 0 rows (RLS blocks cross-worker visibility)

-- 3.2 Employer: can only see certs for workers assigned to their shifts
-- Run AS employer user (uid = EMPLOYER_UID):
SELECT wc.id, wc.worker_user_id, wc.type, wc.status
FROM worker_certifications wc
WHERE NOT public.can_employer_see_worker(wc.worker_user_id);
-- EXPECTED: 0 rows (employer cannot see certs of unrelated workers)

-- 3.3 Admin: can see all worker_certifications
-- Run AS admin user (has user_roles entry with role = 'admin'):
SELECT COUNT(*) FROM worker_certifications;
-- EXPECTED: Total count of all certifications (not filtered by worker_user_id)

-- 3.4 Warehouse provider: can only see their own bookings
-- Run AS warehouse provider user:
SELECT id FROM warehouse_bookings
WHERE warehouse_company_id NOT IN (
  SELECT company_id FROM company_users WHERE user_id = auth.uid()
)
AND customer_company_id NOT IN (
  SELECT company_id FROM company_users WHERE user_id = auth.uid()
);
-- EXPECTED: 0 rows

-- 3.5 Service provider: cannot see other companies' service_listings
SELECT id FROM service_listings
WHERE company_id NOT IN (
  SELECT company_id FROM company_users WHERE user_id = auth.uid()
)
AND status != 'Available';
-- EXPECTED: 0 rows (only Available listings are public; private ones are company-scoped)

-- =============================================================================
-- SECTION 4: End-to-end workflow spot checks
-- =============================================================================

-- 4.1 Worker document upload → admin approve
-- Step 1: Worker uploads cert (creates worker_certifications row with status='Pending')
-- Step 2: Admin queries: SELECT * FROM worker_certifications WHERE status = 'Pending'
-- Step 3: Admin calls: SELECT public.admin_approve_certification('CERT_ID', 'Looks valid')
-- Step 4: Verify:
SELECT id, status, reviewed_at, reviewed_by
FROM worker_certifications
WHERE id = 'REPLACE_WITH_CERT_ID';
-- EXPECTED: status = 'Approved', reviewed_at IS NOT NULL, reviewed_by = admin uid

-- Step 5: Verify audit log was written:
SELECT entity_type, entity_id, action, actor_user_id
FROM audit_logs
WHERE entity_type = 'worker_certifications'
  AND entity_id = 'REPLACE_WITH_CERT_ID'
ORDER BY created_at DESC LIMIT 1;
-- EXPECTED: action = 'admin_approve_certification'

-- 4.2 Booking counter-offer → notification delivered
-- After bookings.submitCounterOffer is called, check:
SELECT user_id, kind, title, body, created_at
FROM notifications
WHERE kind = 'booking_counter_offer'
ORDER BY created_at DESC LIMIT 5;
-- EXPECTED: Row with kind='booking_counter_offer' for the customer company members

-- 4.3 Employer confirm hours → worker notification
-- After shifts.confirmHours is called, check:
SELECT user_id, kind, title, body, created_at
FROM notifications
WHERE kind = 'hours_confirmed'
ORDER BY created_at DESC LIMIT 5;
-- EXPECTED: Row with kind='hours_confirmed' for the worker user_id

-- 4.4 New company onboarding → admin notification
-- After setup_my_company RPC completes, check:
SELECT user_id, kind, title, body, entity_id, created_at
FROM notifications
WHERE kind = 'company_pending'
ORDER BY created_at DESC LIMIT 5;
-- EXPECTED: Row(s) sent to admin user_ids with entity_id = new company's id

-- 4.5 Gate event → status advance + gate_events row
-- After yard.recordEvent is called:
SELECT appointment_id, kind, notes, created_at
FROM gate_events
ORDER BY created_at DESC LIMIT 5;
-- EXPECTED: New row with the event kind that was recorded

-- Check that dock_appointment status was advanced:
SELECT id, status, check_in_ts
FROM dock_appointments
WHERE id = 'REPLACE_WITH_APPOINTMENT_ID';
-- EXPECTED: status advanced to the next valid state (e.g. CheckedIn if kind=check_in)

-- =============================================================================
-- SECTION 5: Return Authorization enum validation
-- =============================================================================

-- 5.1 Confirm return_status enum values (must match UI)
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'return_status'
ORDER BY enumsortorder;
-- EXPECTED: Requested, Approved, Rejected, Received, Refunded, Closed
-- UI now uses: Requested, Approved (incoming tab), Received (restock), Closed (dispose)

-- 5.2 Confirm no return_authorizations rows have invalid statuses:
SELECT DISTINCT status FROM return_authorizations;
-- EXPECTED: All values are in {Requested, Approved, Rejected, Received, Refunded, Closed}

-- =============================================================================
-- SECTION 6: Fulfillment order gating
-- =============================================================================

-- 6.1 Attempt to create a fulfillment order for a Requested booking.
--     Call: trpc.fulfillment.createOrder({ bookingId: 'BOOKING_IN_REQUESTED_STATUS', ... })
--     EXPECTED: Error — "Cannot create fulfillment orders for a booking with status 'Requested'..."

-- 6.2 Create a fulfillment order for an Accepted booking.
--     Call: trpc.fulfillment.createOrder({ bookingId: 'BOOKING_IN_ACCEPTED_STATUS', ... })
--     EXPECTED: Success — order created

-- =============================================================================
-- SECTION 7: Trucking driver_user_id assignment
-- =============================================================================

-- 7.1 After creating a fleet driver with an email that matches a registered Driver-role user:
SELECT id, name, data
FROM drivers
ORDER BY created_at DESC LIMIT 5;
-- EXPECTED: data column contains { "name": "...", "email": "...", "userId": "<auth_uid>" }
--           for any driver whose email matched a profile

-- 7.2 After assigning a driver to a dock appointment:
SELECT id, driver_name, driver_user_id, status
FROM dock_appointments
ORDER BY updated_at DESC LIMIT 5;
-- EXPECTED: driver_user_id is set (not null) if the driver had a linked userId in their data

-- 7.3 Driver can see their assigned jobs via driverJobs query:
-- Run AS driver user (uid = DRIVER_AUTH_UID):
SELECT id, status, scheduled_start, driver_name, driver_user_id
FROM dock_appointments
WHERE driver_user_id = auth.uid()
   OR driver_name = (SELECT name FROM profiles WHERE id = auth.uid());
-- EXPECTED: Appointments assigned to this driver via either method

-- =============================================================================
-- SECTION 8: Manual test checklist (requires live app + Supabase connection)
-- =============================================================================

/*
  NEEDS LIVE VERIFICATION — cannot be confirmed from code alone:

  [ ] Migration 0056 applied → SELECT * FROM admin_role_audit() shows is_admin_result = true
  [ ] Migration 0057 applied → Normal user cannot set own role/status/company_id
  [ ] SuperAdmin can see worker_certifications with status = 'Pending'
  [ ] SuperAdmin can call admin_approve_certification / admin_reject_certification
  [ ] audit_logs row written after cert approval
  [ ] Worker receives in-app notification after employer confirms hours
  [ ] Admin receives in-app notification when new company is created via setup_my_company
  [ ] Customer receives counter-offer notification when warehouse submits counter
  [ ] fulfillment.createOrder blocked for bookings with status != Accepted/Active
  [ ] Fleet driver with email creates linked driver_user_id on appointment assignment
  [ ] gate_record_event writes gate_events row AND advances dock_appointment status atomically
  [ ] RLS: Worker cannot read other workers' certifications
  [ ] RLS: Employer can only read certs for their assigned workers
  [ ] RLS: Service provider cannot read other companies' non-public listings
  [ ] Returns UI: "Restock" advances status to 'Received' (not 'Restocked')
  [ ] Returns UI: "Dispose" advances status to 'Closed' (not 'Disposed')
  [ ] Return incoming tab shows only Requested and Approved RMAs
  [ ] Stripe webhook: payment_intent.succeeded → invoice Paid + payout Pending
*/
