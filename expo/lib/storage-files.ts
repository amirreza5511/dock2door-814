import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type Bucket = 'certifications' | 'warehouse-docs' | 'booking-docs' | 'invoices' | 'attachments';

export interface UploadArgs {
  bucket: Bucket;
  path: string;
  file: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
}

export interface UploadedFileMeta {
  id: string;
  bucket: Bucket;
  path: string;
  size: number;
}

function sanitize(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildCertPath(workerUserId: string, certificationId: string, filename: string): string {
  return `${workerUserId}/${certificationId}/${sanitize(filename)}`;
}

export function buildWarehouseDocPath(companyId: string, listingId: string, filename: string): string {
  return `${companyId}/${listingId}/${sanitize(filename)}`;
}

export function buildBookingDocPath(bookingId: string, uploaderCompanyId: string, filename: string): string {
  return `${bookingId}/${uploaderCompanyId}/${sanitize(filename)}`;
}

export async function uploadFileWithMetadata(args: UploadArgs): Promise<UploadedFileMeta> {
  console.log('[storage] upload', args.bucket, args.path);
  const payload = args.file as Blob;

  const { error: upErr } = await supabase.storage
    .from(args.bucket)
    .upload(args.path, payload, {
      contentType: args.contentType,
      upsert: false,
    });
  if (upErr) {
    console.log('[storage] upload failed', upErr.message);
    throw new Error(upErr.message);
  }

  const size = typeof (payload as Blob).size === 'number' ? (payload as Blob).size : 0;

  const { data: userRes } = await supabase.auth.getUser();
  const uploaderUserId = userRes.user?.id ?? null;

  const { data, error } = await supabase
    .from('storage_files')
    .insert({
      bucket: args.bucket,
      path: args.path,
      entity_type: args.entityType,
      entity_id: args.entityId ?? null,
      company_id: args.companyId ?? null,
      uploader_user_id: uploaderUserId,
      mime: args.contentType ?? null,
      size_bytes: size,
    })
    .select('id')
    .single();

  if (error) {
    console.log('[storage] metadata insert failed, rolling back', error.message);
    await supabase.storage.from(args.bucket).remove([args.path]);
    throw new Error(error.message);
  }

  return { id: data.id as string, bucket: args.bucket, path: args.path, size };
}

export async function getSignedUrl(bucket: Bucket, path: string, expiresInSeconds: number = 60): Promise<string> {
  // Preferred: go through the `get-signed-url` Edge Function for defense-in-depth
  // authorization (re-runs `can_read_storage_object` server-side + audit log).
  // Falls back to direct storage signing when the Edge Function isn't deployed
  // (development / local Supabase).
  try {
    const { data, error } = await supabase.functions.invoke<{ signedUrl?: string; error?: string }>('get-signed-url', {
      body: { bucket, path, expiresIn: expiresInSeconds },
    });
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    if (error) {
      console.log('[storage] get-signed-url edge function unavailable, falling back', error.message);
    }
  } catch (err) {
    console.log('[storage] get-signed-url invoke threw, falling back', err);
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Unable to generate signed URL');
  }
  return data.signedUrl;
}

export async function pickAndUploadFromUri(params: {
  uri: string;
  bucket: Bucket;
  path: string;
  contentType: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
}): Promise<UploadedFileMeta> {
  let body: Blob;
  if (Platform.OS === 'web') {
    const res = await fetch(params.uri);
    body = await res.blob();
  } else {
    const res = await fetch(params.uri);
    body = await res.blob();
  }
  return uploadFileWithMetadata({
    bucket: params.bucket,
    path: params.path,
    file: body,
    contentType: params.contentType,
    entityType: params.entityType,
    entityId: params.entityId,
    companyId: params.companyId,
  });
}
