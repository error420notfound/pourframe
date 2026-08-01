#pragma once

namespace frontend_delivery {

enum class Representation {
  NotFound,
  Raw,
  Gzip,
  NotAcceptable,
};

enum class RequestTarget {
  Api,
  DirectGzip,
  Root,
  ExactAsset,
  SpaFallback,
};

bool acceptsGzip(const char *acceptEncoding);
const char *contentTypeForPath(const char *path);
const char *cacheControlForPath(const char *path, bool spaFallback);
Representation selectRepresentation(bool rawExists, bool gzipExists, bool gzipAccepted);
RequestTarget classifyRequest(const char *path, bool exactAssetExists);

}  // namespace frontend_delivery
