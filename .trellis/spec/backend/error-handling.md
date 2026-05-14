# Error Handling

## Overview

Backend errors are normalized through `AppError` in `src/server/errors.ts`. Routes should throw typed errors and let Fastify's error handler serialize the response.

## API Error Response

```json
{
  "error": {
    "code": "bad_request",
    "message": "请求参数无效",
    "details": {}
  }
}
```

## Scenario: API Error Contract

### 1. Scope / Trigger
- Trigger: New route, validation rule, auth rule, Notion failure path, or destructive operation.

### 2. Signatures
- `badRequest(message, details?)`
- `unauthorized(message?)`
- `notFound(message?)`
- `conflict(message, details?)`
- `sendError(reply, error)`

### 3. Contracts
- Request validation uses Zod and throws `400 bad_request`.
- If a Zod schema provides a localized Chinese validation message, `parseBody` uses that message as the API error message; otherwise it falls back to `请求参数无效`.
- Missing login returns `401 unauthorized`.
- Authenticated destructive operations require explicit route logic and UI confirmation.
- Notion item-level failures are recorded on run items; global failures fail the run.

### 4. Validation & Error Matrix
- Invalid body -> `400 bad_request`.
- Invalid body with localized schema message -> `400 bad_request` with that message.
- No session -> `401 unauthorized`.
- Existing admin setup -> `409 conflict`.
- Missing run/plan -> `404 not_found`.
- Notion `401/403/404` -> do not retry.
- Notion `429/5xx/network timeout` -> retry before final failure.

### 5. Good/Base/Bad Cases
- Good: failed page backup marks one item failed and continues.
- Base: invalid token is not saved.
- Bad: leaking Notion token or encryption key in an error message.

### 6. Tests Required
- Unit-test validators for missing fields.
- Integration-test route error shape for new public APIs.

### 7. Wrong vs Correct

#### Wrong
```ts
throw new Error(`Token failed: ${token}`);
```

#### Correct
```ts
throw unauthorized("Notion token 无效或权限不足");
```

## Scenario: Notion Token Validation

### 1. Scope / Trigger
- Trigger: Accepting or changing Notion token input for `/api/notion/connection`.

### 2. Signatures
- `notionTokenSchema` validates `{ token: string }`.
- Token prefix is defined by `NOTION_TOKEN_PREFIX` in `src/shared/constants.ts`.

### 3. Contracts
- Request token is trimmed before validation.
- Valid integration tokens must start with `NOTION_TOKEN_PREFIX` (`ntn_`).
- Frontend placeholder/local validation and backend Zod validation must use the same shared constant.

### 4. Validation & Error Matrix
- Missing/too short token -> `400 bad_request`.
- Token not starting with `NOTION_TOKEN_PREFIX` -> `400 bad_request`.
- Notion rejects token after schema validation -> normalized Notion auth error; never save the token.

### 5. Good/Base/Bad Cases
- Good: `ntn_...` passes schema validation and is then verified against Notion.
- Base: surrounding whitespace is trimmed before validation.
- Bad: accepting legacy `secret_...` tokens or hardcoding a different prefix in UI copy.

### 6. Tests Required
- Unit-test `notionTokenSchema` with a valid `ntn_...` token and a rejected `secret_...` token.

### 7. Wrong vs Correct

#### Wrong
```ts
token: z.string().trim().min(10)
```

#### Correct
```ts
token: z.string().trim().min(10).refine((value) => value.startsWith(NOTION_TOKEN_PREFIX))
```
