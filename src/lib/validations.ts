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
// points to (MediaFire). The two flag booleans are independent so admins
// can mix and match any combination.
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
  require_subscribe: z.boolean(),
  require_like: z.boolean(),
  active: z.boolean(),
});
