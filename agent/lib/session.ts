import type { ToolContext } from "eve/tools";

export const FALLBACK_USER_ID = "default_user";

export function resolveUserId(ctx: ToolContext): string {
  return ctx.session.auth.current?.principalId ?? FALLBACK_USER_ID;
}
