import { z } from "zod";

/** Only losslessly supported wire types. Unsupported schemas fail at setup time. */
export function strictJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodNullable) return { anyOf: [strictJsonSchema(schema.unwrap()), { type: "null" }] };
  if (schema instanceof z.ZodArray) return { type: "array", items: strictJsonSchema(schema.element) };
  if (schema instanceof z.ZodObject) {
    const properties = Object.fromEntries(Object.entries(schema.shape).map(([key, value]) => [key, strictJsonSchema(value as z.ZodTypeAny)]));
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  }
  throw new Error("Unsupported strict output schema. Use required, nullable wire fields and validate business rules locally.");
}
