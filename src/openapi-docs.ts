export const swaggerUIDocsHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gate Video Stream REST API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.32.8/swagger-ui.css" />
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .topbar { display: none; }
    .docs-header { padding: 18px 24px; border-bottom: 1px solid #ddd; }
    .docs-header h1 { margin: 0 0 8px; font-size: 24px; }
    .docs-header p { margin: 0 0 12px; max-width: 860px; line-height: 1.5; }
    .docs-header a { margin-right: 12px; color: #111; }
  </style>
</head>
<body>
  <header class="docs-header">
    <h1>Gate Video Stream REST API</h1>
    <p>Import the OpenAPI URL into Bruno, Postman, or Insomnia.</p>
    <a href="/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI JSON</a>
    <a href="https://github.com/Gratheon/gate-video-stream" target="_blank" rel="noopener noreferrer">GitHub</a>
  </header>
  <main id="swagger-ui"></main>
  <script src="https://unpkg.com/swagger-ui-dist@5.32.8/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true
    });
  </script>
</body>
</html>`;
