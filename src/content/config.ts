import { z, defineCollection } from "astro:content";

const gamesSchema = z.object({
    title: z.string(),
    description: z.string(),
    categories: z.array(z.string()),
    developer: z.string(),
    released: z.string(),
    technology: z.string(),
    platforms: z.string(),
    thumbnailUrl: z.string(),
    videoUrl: z.string(),
    iframeUrl: z.string().optional(),
    rvmUrl: z.string().optional(),
    rvmCommand: z.string().optional(),
});

const gamesCollection = defineCollection({ type: 'content', schema: gamesSchema });

export const collections = {
    'games': gamesCollection
}