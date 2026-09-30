import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';

const SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), 'openapi.json');
const DOCS_PATH = '/api/docs';

export function loadOpenApiSpec() {
  return JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
}

function allowSwaggerUi(_req, res, next) {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Origin-Agent-Cluster');
  next();
}

export function mountApiDocs(app) {
  const openApiSpec = loadOpenApiSpec();

  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  app.use(DOCS_PATH, allowSwaggerUi);
  app.use(
    DOCS_PATH,
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'Choir API',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    })
  );
}
