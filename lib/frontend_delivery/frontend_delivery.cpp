#include "frontend_delivery.h"

#include <cctype>
#include <cstdlib>
#include <cstring>

namespace frontend_delivery {
namespace {
bool equalsIgnoreCase(const char *begin, const char *end, const char *expected) {
  const size_t length = static_cast<size_t>(end - begin);
  if (strlen(expected) != length) return false;
  for (size_t index = 0; index < length; ++index) {
    if (tolower(static_cast<unsigned char>(begin[index])) != tolower(static_cast<unsigned char>(expected[index]))) return false;
  }
  return true;
}

void trim(const char *&begin, const char *&end) {
  while (begin < end && isspace(static_cast<unsigned char>(*begin))) ++begin;
  while (end > begin && isspace(static_cast<unsigned char>(*(end - 1)))) --end;
}

double qualityForToken(const char *parameters, const char *end) {
  double quality = 1.0;
  while (parameters < end) {
    if (*parameters == ';') ++parameters;
    const char *parameterEnd = parameters;
    while (parameterEnd < end && *parameterEnd != ';') ++parameterEnd;
    const char *begin = parameters;
    const char *finish = parameterEnd;
    trim(begin, finish);
    const char *equals = begin;
    while (equals < finish && *equals != '=') ++equals;
    const char *nameEnd = equals;
    trim(begin, nameEnd);
    if (equals < finish && equalsIgnoreCase(begin, nameEnd, "q")) {
      const char *valueBegin = equals + 1;
      trim(valueBegin, finish);
      const size_t length = static_cast<size_t>(finish - valueBegin);
      if (length == 0 || length >= 16) return 0.0;
      char value[16];
      memcpy(value, valueBegin, length);
      value[length] = '\0';
      char *parsedEnd = nullptr;
      const double parsed = strtod(value, &parsedEnd);
      if (parsedEnd == value || *parsedEnd != '\0' || parsed < 0.0 || parsed > 1.0) return 0.0;
      quality = parsed;
    }
    parameters = parameterEnd;
  }
  return quality;
}

bool endsWithIgnoreCase(const char *value, const char *suffix) {
  if (value == nullptr) return false;
  const size_t valueLength = strlen(value);
  const size_t suffixLength = strlen(suffix);
  if (valueLength < suffixLength) return false;
  return equalsIgnoreCase(value + valueLength - suffixLength, value + valueLength, suffix);
}
}  // namespace

bool acceptsGzip(const char *acceptEncoding) {
  if (acceptEncoding == nullptr) return false;
  bool gzipSpecified = false;
  double gzipQuality = 0.0;
  double wildcardQuality = 0.0;

  const char *token = acceptEncoding;
  while (*token != '\0') {
    const char *tokenEnd = strchr(token, ',');
    if (tokenEnd == nullptr) tokenEnd = token + strlen(token);
    const char *nameBegin = token;
    const char *parameters = nameBegin;
    while (parameters < tokenEnd && *parameters != ';') ++parameters;
    const char *nameEnd = parameters;
    trim(nameBegin, nameEnd);
    const double quality = qualityForToken(parameters, tokenEnd);
    if (equalsIgnoreCase(nameBegin, nameEnd, "gzip")) {
      gzipSpecified = true;
      gzipQuality = quality;
    } else if (equalsIgnoreCase(nameBegin, nameEnd, "*")) {
      wildcardQuality = quality;
    }
    if (*tokenEnd == '\0') break;
    token = tokenEnd + 1;
  }

  return gzipSpecified ? gzipQuality > 0.0 : wildcardQuality > 0.0;
}

const char *contentTypeForPath(const char *path) {
  if (endsWithIgnoreCase(path, ".html") || endsWithIgnoreCase(path, ".htm")) return "text/html";
  if (endsWithIgnoreCase(path, ".js") || endsWithIgnoreCase(path, ".mjs")) return "text/javascript";
  if (endsWithIgnoreCase(path, ".css")) return "text/css";
  if (endsWithIgnoreCase(path, ".json")) return "application/json";
  if (endsWithIgnoreCase(path, ".svg")) return "image/svg+xml";
  if (endsWithIgnoreCase(path, ".woff2")) return "font/woff2";
  if (endsWithIgnoreCase(path, ".png")) return "image/png";
  if (endsWithIgnoreCase(path, ".jpg") || endsWithIgnoreCase(path, ".jpeg")) return "image/jpeg";
  if (endsWithIgnoreCase(path, ".webp")) return "image/webp";
  return "application/octet-stream";
}

Representation selectRepresentation(bool rawExists, bool gzipExists, bool gzipAccepted) {
  if (gzipAccepted && gzipExists) return Representation::Gzip;
  if (rawExists) return Representation::Raw;
  if (gzipExists) return Representation::NotAcceptable;
  return Representation::NotFound;
}

RequestTarget classifyRequest(const char *path, bool exactAssetExists) {
  if (path != nullptr && strncmp(path, "/api/", 5) == 0) return RequestTarget::Api;
  if (endsWithIgnoreCase(path, ".gz")) return RequestTarget::DirectGzip;
  if (path != nullptr && strcmp(path, "/") == 0) return RequestTarget::Root;
  return exactAssetExists ? RequestTarget::ExactAsset : RequestTarget::SpaFallback;
}

}  // namespace frontend_delivery
