import { defineCollection, z } from 'astro:content';
import { tagNames } from './tags';

// Shared schema for all collections（image() 只能在 schema 函数里拿到）
const baseSchema = ({ image }: { image: () => z.ZodTypeAny }) => z.object({
  title: z.string(),
  pubDate: z.coerce.date(),
  description: z.string(),
  tags: z.array(z.string()).max(3),
  status: z.enum(['Flop', 'Turn', 'River', '起', '承', '合']).default('Flop'),
  locale: z.enum(['en', 'zh']).optional().default('en'),
  slug: z.string().optional(), // Custom slug for i18n mapping
  draft: z.boolean().default(true),
  book_title: z.string().optional(),
  alias: z.array(z.string()).optional(),
  rating: z.number().min(1).max(5).optional(),
  series: z.string().optional(), // 系列名，同名文章在文章页互相链接
  translationKey: z.string().min(1).optional(),
  updatedDate: z.coerce.date().optional(),
  revisionNote: z.string().optional(),
  bookId: z.string().min(1).optional(),
  seriesId: z.string().min(1).optional(),
  seriesOrder: z.number().int().positive().optional(),
  related: z.array(z.string().min(1)).optional(), // 相关文章的 postKey（collection/slug）
  cover: image().optional(), // 卡片/分享用的题图，相对路径指向 _assets
  coverAlt: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.updatedDate && data.updatedDate < data.pubDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['updatedDate'], message: '修订日期不能早于发布日期' });
  }
  const allowed: readonly string[] = tagNames(data.locale);
  for (const tag of data.tags) {
    if (!allowed.includes(tag)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tags'],
        message: `标签「${tag}」不在词表里（src/content/tags.ts）。可用：${allowed.join(' / ')}`,
      });
    }
  }
});

// Studio collection - Learning notes, AI, Tech explorations (was AI)
const studioCollection = defineCollection({
  type: 'content',
  schema: baseSchema,
});

// Library collection - books, reflections, taste
const libraryCollection = defineCollection({
  type: 'content',
  schema: baseSchema,
});

// Cafe collection - Personal thoughts, essays, "Manager to IC" (was XR)
const cafeCollection = defineCollection({
  type: 'content',
  schema: baseSchema,
});

// Club collection - Hobbies, Poker, Recreation
const clubCollection = defineCollection({
  type: 'content',
  schema: baseSchema,
});

export const collections = {
  'studio': studioCollection,
  'library': libraryCollection,
  'cafe': cafeCollection,
  'club': clubCollection,
};
