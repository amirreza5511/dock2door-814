/**
 * ADVERTISING KIT — tRPC endpoint handlers.
 *
 * Paste these key/value entries into your project's tRPC procedure map
 * (in the original project this lives in expo/lib/trpc.ts). They assume the
 * same helpers the rest of that file uses:
 *   - `supabase`  — the Supabase client
 *   - `isAdmin(role)` — role check helper
 *   - `throwErr(error, message)` — error normaliser
 *   - `isMissingRelation(error)` / `isMissingColumn(error)` — schema guards
 *   - `AnyRecord` — a `Record<string, unknown>` alias
 *   - `ctx.user` — the authenticated user ({ id, role, companyId })
 *
 * If your new project structures tRPC differently, port each handler body
 * (the Supabase calls) into your equivalent procedures — the logic is what
 * matters, not the exact shape.
 *
 * NOTE: `admin.approveAd` calls `admin_settle_advertisement` and
 * `admin.billAdUsage` calls `admin_bill_ad_usage`. Those need the invoices +
 * sandbox settle engine (see README). If you don't port billing, drop those
 * two calls and just flip review_status/status directly.
 */

export const adEndpoints = {
  // ── Public: serve + tracking ───────────────────────────────────────────
  'ads.serve': async (input: { placement?: string } | undefined) => {
    const placement = input?.placement ?? 'all';
    const nowIso = new Date().toISOString();
    const richCols = 'id,title,body,image_url,target_url,cta_label,advertiser_name,placement,placements,links,priority,starts_at,ends_at,media_type,video_url,link_type,max_impressions,weight,impressions,clicks,pricing_model,cpm_rate,cpc_rate,budget_cap';
    let data: AnyRecord[] | null = null;
    let error: unknown = null;
    {
      const res = await supabase
        .from('advertisements')
        .select(richCols)
        .eq('status', 'Active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      data = res.data as AnyRecord[] | null;
      error = res.error;
    }
    if (error && isMissingColumn(error)) {
      const res = await supabase
        .from('advertisements')
        .select('id,title,body,image_url,target_url,cta_label,advertiser_name,placement,priority,starts_at,ends_at')
        .eq('status', 'Active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      data = res.data as AnyRecord[] | null;
      error = res.error;
    }
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load ads');
    }
    return (data ?? []).filter((a) => {
      const list = Array.isArray(a.placements) && (a.placements as string[]).length > 0
        ? (a.placements as string[])
        : [a.placement as string];
      if (!list.includes('all') && !list.includes(placement)) return false;
      const startsAt = a.starts_at as string | null;
      const endsAt = a.ends_at as string | null;
      if (startsAt && startsAt > nowIso) return false;
      if (endsAt && endsAt < nowIso) return false;
      const cap = Number(a.max_impressions ?? 0);
      const shown = Number(a.impressions ?? 0);
      if (cap > 0 && shown >= cap) return false;
      const budget = Number(a.budget_cap ?? 0);
      if (budget > 0) {
        const model = String(a.pricing_model ?? 'flat');
        const accrued = model === 'cpm'
          ? (shown / 1000) * Number(a.cpm_rate ?? 0)
          : model === 'cpc'
            ? Number(a.clicks ?? 0) * Number(a.cpc_rate ?? 0)
            : 0;
        if (accrued >= budget) return false;
      }
      return true;
    });
  },

  'ads.recordImpression': async (input: { id: string }) => {
    const { error } = await supabase.rpc('ad_record_impression', { p_id: input.id });
    if (error && !isMissingRelation(error)) return { success: false };
    return { success: true };
  },

  'ads.recordClick': async (input: { id: string; linkType?: string }) => {
    if (input.linkType && input.linkType.length > 0) {
      const res = await supabase.rpc('ad_record_link_click', { p_id: input.id, p_link_type: input.linkType });
      if (!res.error) return { success: true };
    }
    const { error } = await supabase.rpc('ad_record_click', { p_id: input.id });
    if (error && !isMissingRelation(error)) return { success: false };
    return { success: true };
  },

  // ── Admin ad management ────────────────────────────────────────────────
  'admin.listAds': async (_input, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase
      .from('advertisements')
      .select('*')
      .order('status', { ascending: true })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error)) return [];
      throwErr(error, 'Unable to load ads');
    }
    return data ?? [];
  },

  'admin.upsertAd': async (input: {
    id?: string | null;
    title: string; body?: string; imageUrl?: string; targetUrl?: string; ctaLabel?: string;
    advertiserName?: string; advertiserCompanyId?: string | null;
    placement?: string; placements?: string[]; status?: string; priority?: number;
    startsAt?: string | null; endsAt?: string | null;
    mediaType?: string; videoUrl?: string; linkType?: string;
    links?: { type: string; value: string }[];
    maxImpressions?: number; weight?: number;
    pricingModel?: string; price?: number; cpmRate?: number; cpcRate?: number; budgetCap?: number;
  }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const placements = (input.placements ?? []).filter((p) => p && p.length > 0);
    const primaryPlacement = placements.includes('all')
      ? 'all'
      : (placements[0] ?? (input.placement && input.placement.length > 0 ? input.placement : 'all'));
    const links = (input.links ?? []).filter((l) => l && l.value && l.value.trim().length > 0)
      .map((l) => ({ type: l.type, value: l.value.trim() }));
    const primaryLink = links[0];
    const baseRow: AnyRecord = {
      title: input.title,
      body: input.body ?? '',
      image_url: input.imageUrl ?? '',
      target_url: primaryLink?.value ?? input.targetUrl ?? '',
      cta_label: input.ctaLabel && input.ctaLabel.length > 0 ? input.ctaLabel : 'Learn more',
      advertiser_name: input.advertiserName ?? '',
      advertiser_company_id: input.advertiserCompanyId ?? null,
      placement: primaryPlacement,
      status: input.status && input.status.length > 0 ? input.status : 'Active',
      priority: input.priority ?? 0,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      updated_at: new Date().toISOString(),
    };
    const richRow: AnyRecord = {
      ...baseRow,
      placements: placements.length > 0 ? placements : [primaryPlacement],
      links,
      media_type: input.mediaType && input.mediaType.length > 0 ? input.mediaType : 'image',
      video_url: input.videoUrl ?? '',
      link_type: primaryLink?.type ?? (input.linkType && input.linkType.length > 0 ? input.linkType : 'website'),
      max_impressions: input.maxImpressions ?? 0,
      weight: input.weight ?? 1,
    };
    const usageRow: AnyRecord = {
      pricing_model: input.pricingModel && input.pricingModel.length > 0 ? input.pricingModel : 'flat',
      price: Math.max(0, Number(input.price ?? 0)),
      cpm_rate: Math.max(0, Number(input.cpmRate ?? 0)),
      cpc_rate: Math.max(0, Number(input.cpcRate ?? 0)),
      budget_cap: Math.max(0, Number(input.budgetCap ?? 0)),
    };
    const runUpsert = async (row: AnyRecord) => {
      if (input.id) {
        return supabase.from('advertisements').update(row).eq('id', input.id).select('id').maybeSingle();
      }
      return supabase.from('advertisements').insert({ ...row, created_by: ctx.user.id }).select('id').maybeSingle();
    };
    let res = await runUpsert({ ...richRow, ...usageRow });
    if (res.error && isMissingColumn(res.error)) res = await runUpsert(richRow);
    if (res.error && isMissingColumn(res.error)) res = await runUpsert(baseRow);
    if (res.error) throwErr(res.error, input.id ? 'Unable to update ad' : 'Unable to create ad');
    return { id: String((res.data as AnyRecord | null)?.id ?? input.id ?? '') };
  },

  'admin.billAdUsage': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data, error } = await supabase.rpc('admin_bill_ad_usage', { p_id: input.id });
    if (error) throwErr(error, 'Unable to bill this ad');
    return { billed: Number(data ?? 0) };
  },

  'admin.setAdStatus': async (input: { id: string; status: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase
      .from('advertisements')
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    if (error) throwErr(error, 'Unable to update ad status');
    return { success: true };
  },

  'admin.deleteAd': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').delete().eq('id', input.id);
    if (error) throwErr(error, 'Unable to delete ad');
    return { success: true };
  },

  // ── Self-serve advertising (members advertise their own business) ────────
  'ads.mySubmissions': async (_input, ctx) => {
    const { data, error } = await supabase
      .from('advertisements')
      .select('*')
      .eq('submitted_by', ctx.user.id)
      .eq('source', 'self_serve')
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error) || isMissingColumn(error)) return [];
      throwErr(error, 'Unable to load your ads');
    }
    return data ?? [];
  },

  'ads.submitAd': async (input: {
    id?: string | null;
    title: string; body?: string; imageUrl?: string; ctaLabel?: string;
    advertiserName?: string; placements?: string[];
    mediaType?: string; videoUrl?: string;
    links?: { type: string; value: string }[];
  }, ctx) => {
    if (!input.title || input.title.trim().length === 0) throw new Error('Give your ad a title.');
    const placements = (input.placements ?? []).filter((p) => p && p.length > 0);
    const primaryPlacement = placements.includes('all') ? 'all' : (placements[0] ?? 'all');
    const links = (input.links ?? []).filter((l) => l && l.value && l.value.trim().length > 0)
      .map((l) => ({ type: l.type, value: l.value.trim() }));
    const primaryLink = links[0];
    const row: AnyRecord = {
      title: input.title.trim(),
      body: (input.body ?? '').trim(),
      image_url: (input.imageUrl ?? '').trim(),
      target_url: primaryLink?.value ?? '',
      cta_label: input.ctaLabel && input.ctaLabel.trim().length > 0 ? input.ctaLabel.trim() : 'Learn more',
      advertiser_name: (input.advertiserName ?? '').trim(),
      advertiser_company_id: ctx.user.companyId,
      owner_company_id: ctx.user.companyId,
      placement: primaryPlacement,
      placements: placements.length > 0 ? placements : [primaryPlacement],
      links,
      media_type: input.mediaType && input.mediaType.length > 0 ? input.mediaType : 'image',
      video_url: (input.videoUrl ?? '').trim(),
      link_type: primaryLink?.type ?? 'website',
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      const { error } = await supabase.from('advertisements')
        .update(row).eq('id', input.id).eq('submitted_by', ctx.user.id);
      if (error) throwErr(error, 'Unable to update your ad');
      return { id: input.id };
    }
    const { data, error } = await supabase.from('advertisements')
      .insert({
        ...row,
        source: 'self_serve',
        submitted_by: ctx.user.id,
        status: 'Paused',
        review_status: 'Pending',
        price: 0,
        weight: 1,
        priority: 0,
        created_by: ctx.user.id,
      })
      .select('id').maybeSingle();
    if (error) throwErr(error, 'Unable to submit your ad');
    return { id: String((data as AnyRecord | null)?.id ?? '') };
  },

  'ads.payAd': async (input: { id: string }, _ctx) => {
    const { error } = await supabase.rpc('ad_mark_paid', { p_id: input.id });
    if (error) throwErr(error, 'Unable to record payment');
    return { success: true };
  },

  'ads.cancelSubmission': async (input: { id: string }, ctx) => {
    const { error } = await supabase.from('advertisements')
      .delete().eq('id', input.id).eq('submitted_by', ctx.user.id);
    if (error) throwErr(error, 'Unable to cancel your ad');
    return { success: true };
  },

  'admin.quoteAd': async (input: { id: string; price: number; currency?: string; note?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').update({
      price: Math.max(0, Number(input.price) || 0),
      currency: input.currency && input.currency.length > 0 ? input.currency : 'CAD',
      review_status: 'Quoted',
      admin_note: input.note ?? '',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to send quote');
    return { success: true };
  },

  'admin.approveAd': async (input: { id: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { data: ad } = await supabase.from('advertisements')
      .select('source, price').eq('id', input.id).maybeSingle();
    const adRow = ad as { source?: string | null; price?: number | null } | null;
    if (adRow?.source === 'self_serve' && Number(adRow.price ?? 0) > 0) {
      const { error: settleError } = await supabase.rpc('admin_settle_advertisement', { p_id: input.id });
      if (settleError && !/already|settled|exists/i.test(settleError.message ?? '')) {
        throwErr(settleError, 'Unable to bill this ad');
      }
    }
    const { error } = await supabase.from('advertisements').update({
      review_status: 'Approved',
      status: 'Active',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to approve ad');
    return { success: true };
  },

  'admin.rejectAd': async (input: { id: string; note?: string }, ctx) => {
    if (!isAdmin(ctx.user.role)) throw new Error('Admins only');
    const { error } = await supabase.from('advertisements').update({
      review_status: 'Rejected',
      status: 'Paused',
      admin_note: input.note ?? '',
      updated_at: new Date().toISOString(),
    }).eq('id', input.id);
    if (error) throwErr(error, 'Unable to reject ad');
    return { success: true };
  },
};
