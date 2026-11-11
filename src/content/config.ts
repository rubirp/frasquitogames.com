import { z, defineCollection } from "astro:content";

const gamesSchema = z.object({
    /** Position in the grid, lowest first. */
    order: z.number(),
    title: z.string(),
    /** Language of the title when it is not English (for example "es"). */
    titleLang: z.string().optional(),
    /** A short note about the title, shown above the description. */
    titleNote: z.string().optional(),
    description: z.string(),
    /** One sentence: why the game was made. Shown on the card and in the facts. */
    why: z.string(),
    /** What came out of it, when there is something concrete to say. */
    result: z.string().optional(),
    categories: z.array(z.string()),
    developer: z.string(),
    released: z.string(),
    technology: z.string(),
    platforms: z.string(),
    /** "portrait" gives the player a taller box on phones. */
    orientation: z.enum(["landscape", "portrait"]).default("landscape"),
    thumbnailUrl: z.string(),
    videoUrl: z.string(),
    /** Embedded web build (itch.io). */
    iframeUrl: z.string().optional(),
    /** Amstrad CPC disk image, played in the RVM emulator. */
    rvmUrl: z.string().optional(),
    rvmCommand: z.string().optional(),
    /** External page for the game and the text of its link. */
    pageUrl: z.string(),
    pageLabel: z.string(),
});

const gamesCollection = defineCollection({ type: 'content', schema: gamesSchema });

export const collections = {
    'games': gamesCollection
}
