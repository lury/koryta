import { z } from "zod";
import { campaignTopics, newsletterAskPlaces } from "~~/shared/campaigns";
import { notificationKinds } from "~~/shared/notifications";

/** `users/{uid}`: read and written by its owner only, the uid taken from the
 * token (firestore.rules). The rules let the owner write any field; the API
 * takes the ones the site writes and nothing else. `photoURL` and
 * `newsletterUpdated` are not the reader's to set: the second is stamped
 * here, with the server's clock. */

const topics = z
  .object(
    Object.fromEntries(
      campaignTopics.map((topic) => [topic, z.boolean().optional()]),
    ) as Record<(typeof campaignTopics)[number], z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();

const notifications = z
  .object(
    Object.fromEntries(
      notificationKinds.map((kind) => [kind, z.boolean().optional()]),
    ) as Record<
      (typeof notificationKinds)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

export const mePatch = z
  .object({
    displayName: z.string().trim().max(100).optional(),
    publicProfile: z.boolean().optional(),
    teamMail: z.boolean().optional(),
    notifications: notifications.optional(),
    newsletter: topics.optional(),
    /** Where the newsletter answer was given; required with `newsletter`. */
    newsletterVia: z.enum([...newsletterAskPlaces, "profil"]).optional(),
  })
  .strict()
  .refine((patch) => !patch.newsletter || patch.newsletterVia, {
    message: "newsletterVia is required with newsletter",
  });
export type MePatch = z.infer<typeof mePatch>;

/** The stored document after the patch, maps merged key by key as
 * `setDoc(…, {merge: true})` merged them. `at` is whatever the backend
 * stamps a moment with. */
export function mergeMe<At>(
  stored: Record<string, unknown> | null,
  patch: MePatch,
  at: At,
): Record<string, unknown> {
  const { newsletterVia, newsletter, notifications, ...plain } = patch;
  const next: Record<string, unknown> = { ...(stored ?? {}), ...plain };
  if (notifications) {
    next.notifications = {
      ...((stored?.notifications as object | undefined) ?? {}),
      ...notifications,
    };
  }
  if (newsletter) {
    next.newsletter = {
      ...((stored?.newsletter as object | undefined) ?? {}),
      ...newsletter,
    };
    next.newsletterUpdated = { at, via: newsletterVia };
  }
  return next;
}
