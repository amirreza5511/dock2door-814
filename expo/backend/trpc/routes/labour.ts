import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/backend/trpc/create-context';
import { requireAuthUser, type SessionUser } from '@/backend/auth';
import { createAuditLog } from '@/backend/audit';
import { queryRow, queryRows, withTransaction } from '@/backend/db';
import { notifyCompanyMembers, notifyUser } from '@/backend/events';

interface WorkerProfileRow {
  id: string;
  company_id: string | null;
  owner_user_id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  hourly_rate_min: string;
  bio: string | null;
  rating_average: string;
  rating_count: number;
  status: string | null;
  data: Record<string, unknown> | null;
}

interface ShiftPostRow {
  id: string;
  company_id: string;
  owner_user_id: string;
  warehouse_listing_id: string | null;
  title: string | null;
  role: string | null;
  required_skill: string | null;
  required_certifications: unknown;
  hourly_rate: string;
  start_at: string | null;
  end_at: string | null;
  headcount: number;
  description: string | null;
  status: string | null;
}

interface ShiftApplicationRow {
  id: string;
  shift_post_id: string;
  worker_profile_id: string;
  owner_user_id: string | null;
  message: string | null;
  status: string | null;
  created_at: string;
}

interface ShiftAssignmentRow {
  id: string;
  shift_post_id: string;
  worker_profile_id: string;
  application_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string | null;
  created_at: string;
}

async function getOrCreateWorkerProfile(user: SessionUser): Promise<WorkerProfileRow> {
  const existing = await queryRow<WorkerProfileRow>(
    `SELECT id, company_id, owner_user_id, full_name, phone, city,
            hourly_rate_min::text AS hourly_rate_min, bio,
            rating_average::text AS rating_average, rating_count, status, data
     FROM worker_profiles WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [user.id],
  );
  if (existing) return existing;
  const id = crypto.randomUUID();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO worker_profiles (id, owner_user_id, full_name, status, data)
       VALUES ($1, $2, $3, 'Active', '{}'::jsonb)`,
      [id, user.id, user.name],
    );
  });
  const row = await queryRow<WorkerProfileRow>(
    `SELECT id, company_id, owner_user_id, full_name, phone, city,
            hourly_rate_min::text AS hourly_rate_min, bio,
            rating_average::text AS rating_average, rating_count, status, data
     FROM worker_profiles WHERE id = $1`, [id],
  );
  if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create profile' });
  return row;
}

export const labourRouter = createTRPCRouter({
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthUser(ctx.user);
    return getOrCreateWorkerProfile(user);
  }),

  updateMyProfile: protectedProcedure.input(z.object({
    fullName: z.string().max(120).optional(),
    phone: z.string().max(40).nullable().optional(),
    city: z.string().max(80).nullable().optional(),
    hourlyRateMin: z.number().nonnegative().optional(),
    bio: z.string().max(2000).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const profile = await getOrCreateWorkerProfile(user);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE worker_profiles
         SET full_name = COALESCE($1, full_name),
             phone = COALESCE($2, phone),
             city = COALESCE($3, city),
             hourly_rate_min = COALESCE($4, hourly_rate_min),
             bio = COALESCE($5, bio),
             updated_at = NOW()
         WHERE id = $6`,
        [input.fullName ?? null, input.phone ?? null, input.city ?? null, input.hourlyRateMin ?? null, input.bio ?? null, profile.id],
      );
    });
    return { success: true };
  }),

  addCertification: protectedProcedure.input(z.object({
    name: z.string().min(1).max(120),
    issuingBody: z.string().max(120).nullable().optional(),
    issuedAt: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
    fileId: z.string().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const profile = await getOrCreateWorkerProfile(user);
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO worker_certifications (id, company_id, owner_user_id, name, issuing_body, issued_at, expires_at, file_id, status, data)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, 'Pending', '{}'::jsonb)`,
        [id, profile.company_id, user.id, input.name, input.issuingBody ?? null, input.issuedAt ?? null, input.expiresAt ?? null, input.fileId ?? null],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: profile.company_id,
        entityName: 'worker_certifications', entityId: id, action: 'create',
        newValue: { name: input.name },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  approveCertification: protectedProcedure.input(z.object({ id: z.string(), approve: z.boolean() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can approve certifications' });
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE worker_certifications
         SET status = $1, approved_by_user_id = $2, approved_at = CASE WHEN $1 = 'Approved' THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = $3`,
        [input.approve ? 'Approved' : 'Rejected', user.id, input.id],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: null,
        entityName: 'worker_certifications', entityId: input.id, action: input.approve ? 'approve' : 'reject',
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }),

  createShift: protectedProcedure.input(z.object({
    warehouseListingId: z.string().nullable().optional(),
    title: z.string().min(1).max(120),
    role: z.string().min(1).max(60),
    requiredSkill: z.string().max(60).nullable().optional(),
    requiredCertifications: z.array(z.string()).default([]),
    hourlyRate: z.number().positive(),
    startAt: z.string(),
    endAt: z.string(),
    headcount: z.number().int().positive().default(1),
    description: z.string().max(2000).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (!user.companyId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company context required' });
    if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'End must be after start' });
    }
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO shift_posts (id, company_id, owner_user_id, warehouse_listing_id, title, role, required_skill,
                                  required_certifications, hourly_rate, start_at, end_at, headcount, description, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, 'Posted', '{}'::jsonb)`,
        [id, user.companyId, user.id, input.warehouseListingId ?? null, input.title, input.role, input.requiredSkill ?? null,
         JSON.stringify(input.requiredCertifications), input.hourlyRate, input.startAt, input.endAt, input.headcount, input.description ?? null],
      );
      await createAuditLog(client, {
        actorUserId: user.id, companyId: user.companyId,
        entityName: 'shift_posts', entityId: id, action: 'create',
        newValue: { title: input.title, role: input.role, headcount: input.headcount },
        requestId: ctx.requestId,
      });
    });
    return { id };
  }),

  listShifts: protectedProcedure.input(z.object({
    scope: z.enum(['mine', 'open']).default('open'),
    city: z.string().max(80).optional(),
    role: z.string().max(60).optional(),
  })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const clauses: string[] = [`sp.deleted_at IS NULL`];
    const params: unknown[] = [];
    if (input.scope === 'mine') {
      if (user.role === 'Worker') {
        const profile = await getOrCreateWorkerProfile(user);
        params.push(profile.id);
        clauses.push(`EXISTS (SELECT 1 FROM shift_applications sa WHERE sa.shift_post_id = sp.id AND sa.worker_profile_id = $${params.length})`);
      } else if (user.companyId) {
        params.push(user.companyId);
        clauses.push(`sp.company_id = $${params.length}`);
      }
    } else {
      clauses.push(`sp.status IN ('Posted', 'Filled', 'InProgress')`);
      clauses.push(`sp.start_at >= NOW() - INTERVAL '1 day'`);
    }
    if (input.role) { params.push(input.role); clauses.push(`sp.role = $${params.length}`); }
    if (input.city) {
      params.push(input.city);
      clauses.push(`(sp.warehouse_listing_id IS NULL OR EXISTS (SELECT 1 FROM warehouse_listings wl WHERE wl.id = sp.warehouse_listing_id AND wl.city ILIKE $${params.length}))`);
    }
    return queryRows<ShiftPostRow>(
      `SELECT sp.id, sp.company_id, sp.owner_user_id, sp.warehouse_listing_id, sp.title, sp.role,
              sp.required_skill, sp.required_certifications, sp.hourly_rate::text AS hourly_rate,
              sp.start_at, sp.end_at, sp.headcount, sp.description, sp.status
       FROM shift_posts sp WHERE ${clauses.join(' AND ')} ORDER BY sp.start_at ASC LIMIT 100`,
      params,
    );
  }),

  applyToShift: protectedProcedure.input(z.object({
    shiftPostId: z.string(),
    message: z.string().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    if (user.role !== 'Worker') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only workers can apply to shifts' });
    const profile = await getOrCreateWorkerProfile(user);
    const post = await queryRow<ShiftPostRow>(
      `SELECT id, company_id, owner_user_id, warehouse_listing_id, title, role, required_skill,
              required_certifications, hourly_rate::text AS hourly_rate, start_at, end_at, headcount, description, status
       FROM shift_posts WHERE id = $1 AND deleted_at IS NULL`,
      [input.shiftPostId],
    );
    if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift not found' });
    if (post.status !== 'Posted') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Shift is not open for applications' });
    const existing = await queryRow<{ id: string }>(
      `SELECT id FROM shift_applications WHERE shift_post_id = $1 AND worker_profile_id = $2`,
      [post.id, profile.id],
    );
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'You have already applied to this shift' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO shift_applications (id, company_id, owner_user_id, shift_post_id, worker_profile_id, message, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pending', '{}'::jsonb)`,
        [id, post.company_id, user.id, post.id, profile.id, input.message ?? null],
      );
      await notifyCompanyMembers(client, {
        companyId: post.company_id,
        eventKey: 'shift.application_received',
        title: 'New shift application',
        body: `${profile.full_name ?? user.name} applied to ${post.title ?? post.role ?? 'a shift'}.`,
        metadata: { shiftPostId: post.id, applicationId: id },
      });
    });
    return { id };
  }),

  listApplicationsForShift: protectedProcedure.input(z.object({ shiftPostId: z.string() })).query(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const post = await queryRow<ShiftPostRow>(`SELECT * FROM shift_posts WHERE id = $1 AND deleted_at IS NULL`, [input.shiftPostId]);
    if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== post.company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    return queryRows<ShiftApplicationRow & { worker_name: string | null; rating_average: string; rating_count: number }>(
      `SELECT sa.id, sa.shift_post_id, sa.worker_profile_id, sa.owner_user_id, sa.message, sa.status, sa.created_at,
              wp.full_name AS worker_name, wp.rating_average::text AS rating_average, wp.rating_count
       FROM shift_applications sa
       INNER JOIN worker_profiles wp ON wp.id = sa.worker_profile_id
       WHERE sa.shift_post_id = $1
       ORDER BY sa.created_at ASC`,
      [input.shiftPostId],
    );
  }),

  assignWorker: protectedProcedure.input(z.object({ applicationId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const application = await queryRow<ShiftApplicationRow & { post_company_id: string; post_start_at: string; post_end_at: string; post_headcount: number }>(
      `SELECT sa.id, sa.shift_post_id, sa.worker_profile_id, sa.owner_user_id, sa.message, sa.status, sa.created_at,
              sp.company_id AS post_company_id, sp.start_at AS post_start_at, sp.end_at AS post_end_at, sp.headcount AS post_headcount
       FROM shift_applications sa INNER JOIN shift_posts sp ON sp.id = sa.shift_post_id
       WHERE sa.id = $1`,
      [input.applicationId],
    );
    if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Application not found' });
    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && user.companyId !== application.post_company_id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    const assignmentId = crypto.randomUUID();
    await withTransaction(async (client) => {
      const assigned = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM shift_assignments
         WHERE shift_post_id = $1 AND status NOT IN ('Cancelled', 'NoShow') AND deleted_at IS NULL`,
        [application.shift_post_id],
      );
      if (Number(assigned.rows[0]?.count ?? '0') >= application.post_headcount) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Shift is already fully assigned' });
      }
      await client.query(`UPDATE shift_applications SET status = 'Accepted', updated_at = NOW() WHERE id = $1`, [input.applicationId]);
      await client.query(
        `INSERT INTO shift_assignments (id, company_id, owner_user_id, shift_post_id, worker_profile_id, application_id, scheduled_start, scheduled_end, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Assigned', '{}'::jsonb)`,
        [assignmentId, application.post_company_id, application.owner_user_id, application.shift_post_id, application.worker_profile_id, input.applicationId, application.post_start_at, application.post_end_at],
      );
      await client.query(
        `UPDATE shift_posts SET status = CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_post_id = $1 AND status NOT IN ('Cancelled', 'NoShow')) >= headcount THEN 'Filled' ELSE status END,
                                updated_at = NOW() WHERE id = $1`,
        [application.shift_post_id],
      );
      if (application.owner_user_id) {
        await notifyUser(client, {
          userId: application.owner_user_id,
          companyId: application.post_company_id,
          eventKey: 'shift.assigned',
          title: 'You were assigned a shift',
          body: 'Check your upcoming shifts for details.',
          metadata: { shiftPostId: application.shift_post_id, assignmentId },
        });
      }
    });
    return { id: assignmentId };
  }),

  clockIn: protectedProcedure.input(z.object({ assignmentId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const assignment = await queryRow<ShiftAssignmentRow & { company_id: string }>(
      `SELECT id, company_id, shift_post_id, worker_profile_id, application_id, scheduled_start, scheduled_end, status, created_at
       FROM shift_assignments WHERE id = $1 AND deleted_at IS NULL`,
      [input.assignmentId],
    );
    if (!assignment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found' });
    const profile = await queryRow<{ owner_user_id: string }>(`SELECT owner_user_id FROM worker_profiles WHERE id = $1`, [assignment.worker_profile_id]);
    if (profile?.owner_user_id !== user.id && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the assigned worker can clock in' });
    }
    const existing = await queryRow<{ id: string; clock_out_at: string | null }>(
      `SELECT id, clock_out_at FROM time_entries WHERE assignment_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`,
      [input.assignmentId],
    );
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Already clocked in' });
    const id = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO time_entries (id, company_id, owner_user_id, assignment_id, clock_in_at, status, data)
         VALUES ($1, $2, $3, $4, NOW(), 'Active', '{}'::jsonb)`,
        [id, assignment.company_id, user.id, input.assignmentId],
      );
      await client.query(`UPDATE shift_assignments SET status = 'InProgress', updated_at = NOW() WHERE id = $1`, [input.assignmentId]);
    });
    return { id };
  }),

  clockOut: protectedProcedure.input(z.object({ assignmentId: z.string() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    const entry = await queryRow<{ id: string; clock_in_at: string; owner_user_id: string | null }>(
      `SELECT id, clock_in_at::text AS clock_in_at, owner_user_id FROM time_entries
       WHERE assignment_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`,
      [input.assignmentId],
    );
    if (!entry) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No active clock-in for this assignment' });
    if (entry.owner_user_id !== user.id && user.role !== 'Admin' && user.role !== 'SuperAdmin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the clocked-in worker can clock out' });
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE time_entries
         SET clock_out_at = NOW(),
             total_minutes = GREATEST(EXTRACT(EPOCH FROM (NOW() - clock_in_at)) / 60, 0)::int,
             status = 'Completed', updated_at = NOW()
         WHERE id = $1`,
        [entry.id],
      );
      await client.query(`UPDATE shift_assignments SET status = 'Completed', updated_at = NOW() WHERE id = $1`, [input.assignmentId]);
    });
    return { success: true };
  }),

  rateWorker: protectedProcedure.input(z.object({
    workerProfileId: z.string(),
    assignmentId: z.string().nullable().optional(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthUser(ctx.user);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO worker_ratings (id, worker_profile_id, assignment_id, rater_user_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), input.workerProfileId, input.assignmentId ?? null, user.id, input.rating, input.comment ?? null],
      );
      await client.query(
        `UPDATE worker_profiles
         SET rating_count = rating_count + 1,
             rating_average = ROUND((rating_average * rating_count + $1) / (rating_count + 1), 2),
             updated_at = NOW()
         WHERE id = $2`,
        [input.rating, input.workerProfileId],
      );
    });
    return { success: true };
  }),
});
