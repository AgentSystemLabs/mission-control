# Test Patterns

Templates and idioms for writing behavioral assertions across runners. Inherit project conventions first; fall back to these.

## Three categories per public-surface item

For each exported function / route / class:

1. **Happy path** — typical input → expected output / side effect.
2. **Edge** — boundaries: empty, max, null/undefined where allowed, unicode, large input.
3. **Error** — invalid input, downstream failure, auth/permission denied.

Skip combinations that produce duplicate assertions.

## Behavioral, not structural

**Good:** assert the externally observable contract.
```ts
const user = await createUser({ email: "a@b.com" });
expect(user.id).toBeDefined();
expect(await db.users.find(user.id)).toMatchObject({ email: "a@b.com" });
```

**Bad:** mirror the implementation.
```ts
const spy = vi.spyOn(db.users, "insert");
await createUser({ email: "a@b.com" });
expect(spy).toHaveBeenCalledWith({ email: "a@b.com" }); // tautology
```

## Real DB, mock at the boundary

Real DB:
```ts
beforeEach(async () => { await db.users.deleteAll(); });
```

Mock only third-party APIs requiring real auth. Place the mock at the HTTP/SDK boundary, not deep inside your code:
```ts
vi.mock("stripe", () => ({ default: () => ({ charges: { create: vi.fn().mockResolvedValue({ id: "ch_test" }) } }) }));
```

## Async + error assertions

**Vitest/Jest:**
```ts
await expect(fn()).rejects.toThrow(/invalid email/i);
```

**pytest:**
```python
with pytest.raises(ValueError, match="invalid email"):
    fn()
```

**Go:**
```go
_, err := Fn()
if err == nil || !strings.Contains(err.Error(), "invalid email") {
    t.Fatalf("want invalid email error, got %v", err)
}
```

**Rust:**
```rust
let err = fn().unwrap_err();
assert!(err.to_string().contains("invalid email"));
```

## Snapshot use

Avoid by default. Use only if:
- The project already uses snapshots, AND
- The output is stable, small (<30 lines), and human-reviewable.

Never snapshot full HTML pages, error stacks, or anything containing timestamps/IDs without normalization.

## Naming

Mirror project convention. If none, use the form:

```
<unit>: <scenario> -> <expected outcome>
```

Examples:
- `createUser: duplicate email -> rejects with conflict error`
- `parseDate: ISO string with TZ -> returns UTC Date`
- `auth.middleware: missing token -> 401`

## Setup / teardown

Inline factories beat shared fixtures until 3+ tests need the same setup:

```ts
const makeUser = (overrides = {}) => ({ email: "a@b.com", name: "A", ...overrides });
```

Promote to a fixtures file only when duplication is real, not anticipated.
