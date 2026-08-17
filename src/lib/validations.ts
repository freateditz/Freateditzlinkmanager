import { z } from 'zod';

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), { message: 'URL must start with https://' });

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
  youtube_channel_url: z.union([httpsUrl, z.literal('')]).optional(),
  youtube_video_url: z.union([httpsUrl, z.literal('')]).optional(),
  require_subscribe: z.boolean(),
  require_like: z.boolean(),
  active: z.boolean(),
});
