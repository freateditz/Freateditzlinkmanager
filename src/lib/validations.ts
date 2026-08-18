import { z } from 'zod';

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'URL must start with https://' });

// Resource form schema.
//
// YouTube URLs are NOT part of the resource anymore — they are global
// site configuration (NEXT_PUBLIC_YOUTUBE_CHANNEL_URL,
// NEXT_PUBLIC_YOUTUBE_VIDEO_URL). A resource only declares which steps the
// visitor must complete (Subscribe / Like) and where the actual download
// points to (MediaFire).
//
// Platform is fixed at create time and never edited through the UI.
// counterpart_id is optional and only meaningful when the other side exists.
export const PLATFORM_VALUES = ['windows', 'mac'] as const;
export type Platform = (typeof PLATFORM_VALUES)[number];

const uuid = z
  .string()
  .uuid('Counterpart must be a valid resource id.');

const platformSchema = z.enum(PLATFORM_VALUES, {
  message: 'Platform must be Windows or Mac.',
});

export const resourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(150),
  // Slug is server-generated. We accept it from the form only when editing
  // (so the existing value can flow back through unchanged); the create flow
  // does not include this field in the form anymore.
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
    .optional(),
  mediafire_url: httpsUrl,
  platform: platformSchema,
  // Allow empty string (form sends "" when cleared) or a valid UUID. The
  // server treats empty string as "no counterpart".
  counterpart_id: z
    .union([uuid, z.literal('')])
    .nullable()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  require_subscribe: z.boolean(),
  require_like: z.boolean(),
  active: z.boolean(),
});

export type ResourceInput = z.infer<typeof resourceSchema>;
