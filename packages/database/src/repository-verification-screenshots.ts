import { asc, eq } from "drizzle-orm";
import { DomainError, type VerificationScreenshot } from "@gip/domain";
import type { Database } from "./client.js";
import { verificationItems, verificationScreenshots } from "./schema.js";
import { safeRelative } from "./repository-utils.js";

interface VerificationScreenshotContext {
  db: Database;
}

export async function addVerificationScreenshot(
  ctx: VerificationScreenshotContext,
  input: {
    itemId: string;
    relativePath: string;
    sha256: string;
    bytes: number;
    mimeType: string;
  },
): Promise<void> {
  if (!safeRelative(input.relativePath))
    throw new DomainError("invalid_screenshot_path", "Screenshot path must be relative");
  const exists = await ctx.db
    .select({ id: verificationItems.id })
    .from(verificationItems)
    .where(eq(verificationItems.id, input.itemId))
    .limit(1);
  if (!exists[0])
    throw new DomainError(
      "verification_item_not_found",
      "Verification item was not found",
      undefined,
      404,
    );
  await ctx.db.insert(verificationScreenshots).values(input).onConflictDoNothing();
}

export async function listVerificationScreenshots(
  ctx: VerificationScreenshotContext,
  itemId: string,
): Promise<VerificationScreenshot[]> {
  const rows = await ctx.db
    .select()
    .from(verificationScreenshots)
    .where(eq(verificationScreenshots.itemId, itemId))
    .orderBy(asc(verificationScreenshots.createdAt));
  return rows.map((row) => ({ ...row }));
}

export async function getVerificationScreenshot(
  ctx: VerificationScreenshotContext,
  screenshotId: string,
): Promise<VerificationScreenshot | null> {
  const rows = await ctx.db
    .select()
    .from(verificationScreenshots)
    .where(eq(verificationScreenshots.id, screenshotId))
    .limit(1);
  return rows[0] ? { ...rows[0] } : null;
}

export async function deleteVerificationScreenshot(
  ctx: VerificationScreenshotContext,
  screenshotId: string,
): Promise<VerificationScreenshot> {
  const rows = await ctx.db
    .delete(verificationScreenshots)
    .where(eq(verificationScreenshots.id, screenshotId))
    .returning();
  if (!rows[0])
    throw new DomainError("screenshot_not_found", "Screenshot was not found", undefined, 404);
  return { ...rows[0] };
}
