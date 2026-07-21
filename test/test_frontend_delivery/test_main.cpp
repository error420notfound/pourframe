#include <cstdlib>
#include <iostream>
#include <cstring>

#include "frontend_delivery.h"

#ifdef PIO_UNIT_TESTING
#include <unity.h>
#endif

using frontend_delivery::Representation;
using frontend_delivery::RequestTarget;

namespace {
int failures = 0;

void expect(bool condition, const char *message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    ++failures;
  }
}

void testGzipNegotiation() {
  expect(frontend_delivery::acceptsGzip("gzip, deflate"), "accepts gzip token");
  expect(frontend_delivery::acceptsGzip("br, GZip; q=0.5"), "accepts mixed-case gzip with positive quality");
  expect(frontend_delivery::acceptsGzip("br, *;q=0.8"), "accepts positive wildcard");
  expect(!frontend_delivery::acceptsGzip(nullptr), "missing header does not accept gzip");
  expect(!frontend_delivery::acceptsGzip("br"), "unlisted gzip is not accepted");
  expect(!frontend_delivery::acceptsGzip("gzip;q=0, *;q=1"), "explicit gzip exclusion overrides wildcard");
  expect(!frontend_delivery::acceptsGzip("gzip; q=invalid"), "invalid quality is rejected");
}

void testMimeTypes() {
  expect(strcmp(frontend_delivery::contentTypeForPath("/index.html"), "text/html") == 0, "HTML MIME type");
  expect(strcmp(frontend_delivery::contentTypeForPath("/assets/app.js"), "text/javascript") == 0, "JavaScript MIME type");
  expect(strcmp(frontend_delivery::contentTypeForPath("/assets/app.css"), "text/css") == 0, "CSS MIME type");
  expect(strcmp(frontend_delivery::contentTypeForPath("/manifest.json"), "application/json") == 0, "JSON MIME type");
  expect(strcmp(frontend_delivery::contentTypeForPath("/logo.svg"), "image/svg+xml") == 0, "SVG MIME type");
  expect(strcmp(frontend_delivery::contentTypeForPath("/font.woff2"), "font/woff2") == 0, "WOFF2 MIME type");
}

void testRepresentationSelection() {
  expect(frontend_delivery::selectRepresentation(true, true, true) == Representation::Gzip, "gzip is preferred");
  expect(frontend_delivery::selectRepresentation(true, true, false) == Representation::Raw, "raw fallback is used");
  expect(frontend_delivery::selectRepresentation(false, true, false) == Representation::NotAcceptable, "gzip-only requires negotiation");
  expect(frontend_delivery::selectRepresentation(false, false, true) == Representation::NotFound, "missing asset is not found");
}

void testRequestClassification() {
  expect(frontend_delivery::classifyRequest("/", false) == RequestTarget::Root, "root maps to index");
  expect(frontend_delivery::classifyRequest("/assets/app.js", true) == RequestTarget::ExactAsset, "existing asset is exact");
  expect(frontend_delivery::classifyRequest("/brew/session", false) == RequestTarget::SpaFallback, "client route uses SPA fallback");
  expect(frontend_delivery::classifyRequest("/api/missing", false) == RequestTarget::Api, "API path is excluded");
  expect(frontend_delivery::classifyRequest("/assets/app.js.gz", true) == RequestTarget::DirectGzip, "direct gzip URL is rejected");
}

void runAll() {
  testGzipNegotiation();
  testMimeTypes();
  testRepresentationSelection();
  testRequestClassification();
}
}  // namespace

#ifdef PIO_UNIT_TESTING
void runFrontendDeliveryTests() {
  failures = 0;
  runAll();
  TEST_ASSERT_EQUAL_INT(0, failures);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(runFrontendDeliveryTests);
  return UNITY_END();
}
#else
int main() {
  runAll();
  if (failures != 0) return EXIT_FAILURE;
  std::cout << "frontend delivery tests passed\n";
  return EXIT_SUCCESS;
}
#endif
