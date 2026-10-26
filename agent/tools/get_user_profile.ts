import { defineTool } from "eve/tools";
import { z } from "zod";
import { getUserToday } from "../lib/date";
import { getOrCreateUser } from "../lib/db";
import { resolveUserId } from "../lib/session";

export default defineTool({
  description:
    "Consulta el perfil del usuario: zona horaria, moneda por defecto y fecha de hoy en su zona horaria. Usalo cuando necesites confirmar esos datos.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const userId = resolveUserId(ctx);
    const user = await getOrCreateUser(userId);
    return {
      user_id: user.user_id,
      timezone: user.timezone,
      default_currency: user.default_currency,
      today: getUserToday(user.timezone),
    };
  },
});
