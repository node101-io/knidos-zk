import { type Hook, z } from '@hono/zod-openapi';

export const errorSchema = z
  .object({
    error: z.string().openapi({ description: 'Human-readable failure reason.' }),
  })
  .openapi('Error');

export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  } as const;
}

// Shared validation-failure handler so every sub-app emits the documented
// `{ error }` shape instead of OpenAPIHono's default `{ success, error }`
// envelope. `defaultHook` only applies to routes registered on the same
// instance — sub-apps mounted via `app.route()` don't inherit it, so each
// router must opt in by passing this to its constructor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    const first = result.error.issues[0];
    const message = first
      ? `${first.path.join('.') || 'request'}: ${first.message}`
      : 'invalid request';
    return c.json({ error: message }, 400);
  }
};
