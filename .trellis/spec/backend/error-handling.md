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
- Missing login returns `401 unauthorized`.
- Authenticated destructive operations require explicit route logic and UI confirmation.
- Notion item-level failures are recorded on run items; global failures fail the run.

### 4. Validation & Error Matrix
- Invalid body -> `400 bad_request`.
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
