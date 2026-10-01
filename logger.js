export function log(scope, message) {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}
