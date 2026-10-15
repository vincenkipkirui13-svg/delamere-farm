const app = require('../src/app');

// Preserve the original request path through Vercel's catch-all rewrite.
module.exports = (req, res) => {
  try {
    const parsed = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
    const route = parsed.searchParams.get('__route');
    if (route && route.startsWith('/') && !route.startsWith('//')) {
      parsed.searchParams.delete('__route');
      req.url = route + (parsed.search || '');
    }
  } catch (error) {
    console.error('Unable to normalize Vercel request path:', error.message);
  }
  return app(req, res);
};
