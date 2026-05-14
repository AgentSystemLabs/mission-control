---
name: add-form
description: Scaffold a form in this TanStack Start app following the project's conventions — a single zod schema reused on the client (react-hook-form resolver) AND on the server function (input validation), shadcn `<Form>`/`<FormField>` primitives for the UI, a server function in `src/fn/` that calls a use case or data-access function, a `useMutation` wired to that server fn with optimistic / pending UI, and proper success / error handling that integrates with the route's invalidations. Detects whether the project uses react-hook-form (default in shadcn setups) or TanStack Form, and follows whichever is already in use. Trigger phrases — "add a form", "create form for X", "/add-form", "new form", "form to create/edit X", "form for the new entity", "scaffold a form". Skip for — pure read-only views, search inputs that are not form submissions (use a controlled input directly), and forms whose validation is so trivial the schema-on-both-sides pattern is overkill (single field with no rules).
---

# Add Form

Forms in this stack share one rule: the validation schema is defined once and used in two places — the client form (resolver) and the server function (input parser). Anything else drifts: the client lets the user submit data the server rejects, or the server accepts data the client could never produce.

---

## Phase 1 — Confirm Shape

Confirm with the user:
- Entity / target action (creating a post? editing a project? inviting a user?)
- Fields and their types — name, email, plan (string enum), priority (number 1–5)
- Required vs. optional per field
- Where the form lives (a route page? a Dialog? a Sheet?)
- What happens on success — redirect to the new entity, close a modal, refresh a list

If any of those are vague, ask before generating.

**Exit:** field list, required/optional, success behavior all written down.

---

## Phase 2 — Detect Conventions

Read 1–2 existing forms in `src/components/` or `src/routes/`. Extract:

- Form library: react-hook-form (`useForm` from `react-hook-form`) or TanStack Form (`useForm` from `@tanstack/react-form`)? Match whichever is already in use.
- shadcn primitives in use: `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` (the standard set).
- Submit-button pattern: pending state via `form.formState.isSubmitting` or `mutation.isPending`?
- Toast / notification library: `sonner`, `react-hot-toast`, custom?
- How invalidations are wired after a successful mutation: `queryClient.invalidateQueries({ queryKey: ... })` or a route invalidation pattern.

**Exit:** convention notes recorded.

---

## Phase 3 — Define the Schema (Once)

Create the zod schema in a shared location — typically next to the entity's queries or in `src/schemas/`:

```ts
// src/schemas/post.ts
import { z } from 'zod'

export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().max(10_000),
  authorId: z.string().uuid(),
})

export type CreatePostInput = z.infer<typeof createPostSchema>
```

Both the form and the server function will import from here. Do not duplicate.

**Exit:** schema is exported.

---

## Phase 4 — Server Function

Add a server fn in `src/fn/`:

```ts
// src/fn/createPost.ts
import { createServerFn } from '@tanstack/start'
import { createPostSchema } from '@/schemas/post'
import { createPost as createPostInDA } from '@/data-access/posts'
import { requireUser } from '@/lib/auth'

export const createPost = createServerFn({ method: 'POST' })
  .validator(createPostSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    return createPostInDA({ ...data, authorId: user.id })
  })
```

The server fn:
- Validates with the same schema (no re-declaration).
- Calls `requireUser()` (or the project's auth helper) — never trust an `authorId` from the client.
- Calls a data-access function — does not write `db.insert(...)` directly (the project enforces this via `code-enforce-layers`).

If the project's `requireUser`-equivalent is named differently, use the existing one. Do not invent a new auth helper.

**Exit:** server fn exists; typecheck is clean.

---

## Phase 5 — Form Component

Build the form component. With react-hook-form (most common):

```tsx
'use client'   // if applicable to the rendering context

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { createPostSchema, type CreatePostInput } from '@/schemas/post'
import { createPost } from '@/fn/createPost'
import { postsQueryOptions } from '@/queries/posts'
import { Button } from '@/components/ui/button'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function CreatePostForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(createPostSchema),
    defaultValues: { title: '', body: '', authorId: '' },
  })

  const mutation = useMutation({
    mutationFn: (data: CreatePostInput) => createPost({ data }),
    onSuccess: async (post) => {
      await queryClient.invalidateQueries(postsQueryOptions())
      toast.success('Post created')
      navigate({ to: '/posts/$slug', params: { slug: post.slug } })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not create post')
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Body</FormLabel>
              <FormControl><Textarea {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create post'}
        </Button>
      </form>
    </Form>
  )
}
```

The form must:
- Use the schema as the resolver — no re-declaring validation rules.
- Use `<FormMessage />` for error display per field — never inline `{form.formState.errors.title?.message}`.
- Disable the submit while `mutation.isPending` and show a pending label.
- Call `queryClient.invalidateQueries(...)` on success against the relevant `queryOptions` so the affected list view re-fetches.
- Hand toast.success/error to the project's notification library.

**Exit:** the form renders, validates, and submits successfully against the dev server.

---

## Phase 6 — Wire It In

Place the form in the consuming surface — a route page (`src/routes/posts.new.tsx`), a dialog opened from a button, etc. Match the project's conventions for that surface.

If the form is in a dialog: close the dialog on `mutation.onSuccess` (state lifted to the parent), and reset the form (`form.reset()`).

**Exit:** form is reachable from the UI, submits successfully end-to-end against the dev server.

---

## Phase 7 — Report

```
Form scaffolded:
  Schema:         src/schemas/post.ts (createPostSchema)
  Server fn:      src/fn/createPost.ts
  Component:      src/components/forms/CreatePostForm.tsx
  Mounted at:     src/routes/posts.new.tsx
  Invalidates:    postsQueryOptions

Verify:
  1. Submit with missing title → see field-level error.
  2. Submit valid data → toast appears, list refreshes, navigate fires.
  3. Trigger server error (e.g., authorId not yours) → toast shows error, form re-enables.
```

---

## NEVER

- **NEVER duplicate validation rules between client and server.**
  **Instead:** define the zod schema once in `src/schemas/`; import it on both sides — the form's `zodResolver(...)` and the server fn's `.validator(...)`.
  **Why:** duplicated rules drift. Within a release, the client lets users submit data the server rejects (silent UX failure) or the server accepts data the form could never produce (data corruption). One schema makes drift impossible.

- **NEVER trust ownership ids from the form input.**
  **Instead:** the server fn looks up the user from the session (`requireUser()`) and assigns ownership server-side — never `authorId: input.authorId`.
  **Why:** any field the client controls is a field a malicious caller can change. `authorId` from input lets anyone create posts under any user's name. Ownership comes from the session.

- **NEVER write `db.insert(...)` (or other Drizzle calls) inside a server function.**
  **Instead:** call a data-access function (`createPost(...)` from `src/data-access/posts.ts`).
  **Why:** the project enforces a layer split (`code-enforce-layers`); raw DB calls in `src/fn/` violate the convention. The DA layer is also where shared business logic and side effects live — bypassing it produces drift.

- **NEVER inline error messages with `{form.formState.errors.<field>?.message}` next to inputs.**
  **Instead:** use shadcn's `<FormMessage />` inside `<FormItem>`. It reads the error state for the field and renders the right way.
  **Why:** `<FormMessage />` is the project's accessibility-correct pattern (matches errors to the input via `aria-describedby`); inline access misses that wiring and produces accessibility bugs.

- **NEVER omit the invalidation after a successful mutation.**
  **Instead:** call `queryClient.invalidateQueries(<the affected queryOptions>)` in `onSuccess`. If the mutation creates an entity, invalidate its list query.
  **Why:** without invalidation, the user submits the form successfully but the list view they return to still shows stale data. They click around, see nothing changed, and re-submit — creating duplicates and losing trust.

- **NEVER leave the submit button enabled while the mutation is pending.**
  **Instead:** `disabled={mutation.isPending}` and a pending label ("Creating…").
  **Why:** double-clicks on a slow submit create duplicate entities. The disabled-while-pending pattern is a one-line fix for a real and common bug.

- **NEVER swallow server errors in `onError` with a generic toast.**
  **Instead:** show the actual error message when it's safe to (`error.message`), with a fallback for unknowns.
  **Why:** "Something went wrong" hides errors the user could resolve themselves (validation failures from the server, conflicts, rate limits). A specific message is actionable; a generic one isn't.

- **NEVER hand-roll a form when the project already uses shadcn `<Form>` primitives.**
  **Instead:** match the existing convention (`<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>`).
  **Why:** the shadcn primitives wire up label association, error rendering, focus management. Re-implementing them inline produces accessibility regressions and an inconsistent design system.
