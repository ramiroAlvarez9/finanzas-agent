import { defineTool } from "eve/tools";
import { z } from "zod";
import { CATEGORIES } from "../lib/categories";

export default defineTool({
  description:
    "Devuelve el catálogo de categorías de gastos disponibles, con su slug, nombre, emoji y ejemplos. Usalo cuando el usuario pregunte qué categorías hay o para elegir la categoría correcta.",
  inputSchema: z.object({}),
  async execute() {
    return {
      categories: CATEGORIES.map((category) => ({
        slug: category.slug,
        label: category.label,
        emoji: category.emoji,
        examples: category.keywords.slice(0, 5),
      })),
    };
  },
});
