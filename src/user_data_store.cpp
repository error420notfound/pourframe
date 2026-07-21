#include "user_data_store.h"

#include <LittleFS.h>

#include <cmath>

namespace {
bool boundedString(JsonVariantConst value, size_t minimum, size_t maximum) {
  if (!value.is<const char *>()) return false;
  const char *text = value.as<const char *>();
  if (text == nullptr) return false;
  const size_t length = strlen(text);
  return length >= minimum && length <= maximum;
}

bool finiteInRange(JsonVariantConst value, double minimum, double maximum) {
  if (!value.is<float>() && !value.is<double>() && !value.is<int>() && !value.is<long>() &&
      !value.is<unsigned int>() && !value.is<unsigned long>()) {
    return false;
  }
  const double number = value.as<double>();
  return std::isfinite(number) && number >= minimum && number <= maximum;
}

bool integerInRange(JsonVariantConst value, long minimum, long maximum) {
  if (!finiteInRange(value, minimum, maximum)) return false;
  const double number = value.as<double>();
  return std::floor(number) == number;
}

bool finiteOrNull(JsonVariantConst value) {
  return value.isNull() || finiteInRange(value, -100000, 100000);
}

bool validRevision(JsonObjectConst request, uint32_t current, int &status, String &error) {
  if (!request["base_revision"].is<uint32_t>()) {
    status = 422;
    error = "invalid_revision";
    return false;
  }
  if (request["base_revision"].as<uint32_t>() != current) {
    status = 409;
    error = "revision_conflict";
    return false;
  }
  return true;
}

void copyCollectionEnvelope(JsonDocument &output, uint32_t revision, JsonArrayConst items) {
  output.clear();
  output["v"] = 1;
  output["revision"] = revision;
  output["items"].set(items);
}
}  // namespace

bool UserDataStore::begin() {
  if (!LittleFS.exists("/user") && !LittleFS.mkdir("/user")) {
    Serial.println("User data: could not create /user");
    return false;
  }
  if (!LittleFS.exists(kTracesPath) && !LittleFS.mkdir(kTracesPath)) {
    Serial.println("User data: could not create trace directory");
    return false;
  }
  String error;
  return pruneBrews(error) && pruneOrphanTraces(error);
}

void UserDataStore::makeCollection(JsonDocument &document) const {
  document.clear();
  document["v"] = 1;
  document["revision"] = 0;
  document["items"].to<JsonArray>();
}

bool UserDataStore::loadCollection(const char *path, size_t maxBytes, JsonDocument &document, String &error) const {
  makeCollection(document);
  if (!LittleFS.exists(path)) return true;

  File file = LittleFS.open(path, "r");
  if (!file) {
    error = "storage_unavailable";
    return false;
  }
  if (file.size() == 0 || file.size() > maxBytes) {
    file.close();
    const String quarantine = String(path) + ".corrupt";
    LittleFS.remove(quarantine);
    LittleFS.rename(path, quarantine);
    makeCollection(document);
    Serial.printf("User data: quarantined invalid collection %s\n", path);
    return true;
  }
  const DeserializationError parseError = deserializeJson(document, file);
  file.close();
  if (parseError || document["v"].as<int>() != 1 || !document["revision"].is<uint32_t>() ||
      !document["items"].is<JsonArray>()) {
    const String quarantine = String(path) + ".corrupt";
    LittleFS.remove(quarantine);
    LittleFS.rename(path, quarantine);
    makeCollection(document);
    Serial.printf("User data: quarantined corrupt collection %s\n", path);
    return true;
  }
  return true;
}

bool UserDataStore::writeCollection(const char *path, const JsonDocument &document, String &error) const {
  const String temporary = String(path) + ".tmp";
  LittleFS.remove(temporary);
  File file = LittleFS.open(temporary, "w");
  if (!file) {
    error = "storage_unavailable";
    return false;
  }
  const size_t expected = measureJson(document);
  const size_t maximum = strcmp(path, kRecipesPath) == 0 ? kMaxRecipesFile : kMaxBrewsFile;
  if (expected == 0 || expected > maximum) {
    file.close();
    LittleFS.remove(temporary);
    error = "storage_limit_reached";
    return false;
  }
  const size_t written = serializeJson(document, file);
  file.flush();
  file.close();
  if (written != expected) {
    LittleFS.remove(temporary);
    error = "storage_write_failed";
    return false;
  }

  const String backup = String(path) + ".bak";
  LittleFS.remove(backup);
  if (LittleFS.exists(path) && !LittleFS.rename(path, backup)) {
    LittleFS.remove(temporary);
    error = "storage_write_failed";
    return false;
  }
  if (!LittleFS.rename(temporary, path)) {
    if (LittleFS.exists(backup)) LittleFS.rename(backup, path);
    error = "storage_write_failed";
    return false;
  }
  LittleFS.remove(backup);
  return true;
}

bool UserDataStore::validRecipe(JsonObjectConst recipe, String &error) const {
  if (!boundedString(recipe["id"], 1, 64) || !boundedString(recipe["name"], 1, 80) ||
      !boundedString(recipe["dripper"], 1, 48)) {
    error = "invalid_recipe_identity";
    return false;
  }
  if (!finiteInRange(recipe["coffee"], 5, 80) || !finiteInRange(recipe["water"], 80, 1200) ||
      !finiteInRange(recipe["ratio"], 0.1, 30) || !finiteInRange(recipe["bloom"], 0.001, 1199.999) ||
      !(integerInRange(recipe["poursAfterBloom"], 1, 6) || integerInRange(recipe["pours"], 1, 6)) || !finiteInRange(recipe["brewTime"], 90, 420) ||
      !finiteInRange(recipe["flowRate"], 1, 8) || !finiteInRange(recipe["temperature"], 80, 100)) {
    error = "invalid_recipe_values";
    return false;
  }
  if (recipe["bloom"].as<double>() >= recipe["water"].as<double>()) {
    error = "invalid_recipe_bloom";
    return false;
  }
  if (!boundedString(recipe["grind"], 1, 32) || !boundedString(recipe["agitation"], 0, 120) ||
      !boundedString(recipe["notes"], 0, 500) || !recipe["equipment"].is<JsonArrayConst>()) {
    error = "invalid_recipe_details";
    return false;
  }
  JsonArrayConst equipment = recipe["equipment"].as<JsonArrayConst>();
  if (equipment.size() > 8) {
    error = "recipe_equipment_limit";
    return false;
  }
  for (JsonVariantConst item : equipment) {
    if (!boundedString(item, 1, 48)) {
      error = "invalid_recipe_equipment";
      return false;
    }
  }
  return true;
}

bool UserDataStore::validBrew(JsonObjectConst brew, String &error) const {
  if (!boundedString(brew["id"], 1, 64) || !boundedString(brew["completed_at"], 1, 40) ||
      !finiteInRange(brew["elapsed_s"], 0, 3600) || !brew["recipe"].is<JsonObjectConst>() ||
      !brew["final"].is<JsonObjectConst>() || !brew["sensor_summary"].is<JsonObjectConst>()) {
    error = "invalid_brew_record";
    return false;
  }
  if (!validRecipe(brew["recipe"].as<JsonObjectConst>(), error)) return false;
  JsonObjectConst final = brew["final"].as<JsonObjectConst>();
  if (!finiteOrNull(final["upper_g"]) || !finiteOrNull(final["lower_g"]) ||
      !finiteOrNull(final["total_g"]) || (!final["beverage_g"].isNull() && !finiteOrNull(final["beverage_g"]))) {
    error = "invalid_brew_final";
    return false;
  }
  JsonObjectConst summary = brew["sensor_summary"].as<JsonObjectConst>();
  const char *mode = summary["mode"] | "";
  if (strcmp(mode, "device") != 0 && strcmp(mode, "partial") != 0 && strcmp(mode, "timer_only") != 0) {
    error = "invalid_brew_mode";
    return false;
  }
  // Older records remain readable. New records carry the complete generated
  // schedule, virtual baselines, transition outcomes, and packed-trace metadata.
  const bool expanded = !brew["schedule"].isNull() || !brew["baselines"].isNull() ||
                        !brew["transitions"].isNull() || !brew["trace"].isNull();
  if (expanded && (!brew["schedule"].is<JsonArrayConst>() || !brew["baselines"].is<JsonArrayConst>() ||
                   !brew["transitions"].is<JsonArrayConst>())) {
    error = "invalid_brew_detail";
    return false;
  }
  if (expanded) {
    JsonArrayConst schedule = brew["schedule"].as<JsonArrayConst>();
    JsonArrayConst baselines = brew["baselines"].as<JsonArrayConst>();
    JsonArrayConst transitions = brew["transitions"].as<JsonArrayConst>();
    if (schedule.isNull() || schedule.size() < 2 || schedule.size() > 8 || baselines.size() > 7 ||
        transitions.size() > 8) {
      error = "invalid_brew_detail";
      return false;
    }
    for (JsonVariantConst item : schedule) {
      if (!item.is<JsonObjectConst>() || !boundedString(item["id"], 1, 32) ||
          !finiteInRange(item["start"], 0, 420) || !finiteInRange(item["cumulative"], 0, 1200)) {
        error = "invalid_brew_schedule";
        return false;
      }
    }
    for (JsonVariantConst item : baselines) {
      if (!item.is<JsonObjectConst>() || !boundedString(item["step_id"], 1, 32) ||
          !finiteInRange(item["upper_g"], -100000, 100000) ||
          !finiteInRange(item["lower_g"], -100000, 100000) ||
          !finiteInRange(item["total_g"], -100000, 100000)) {
        error = "invalid_brew_baseline";
        return false;
      }
    }
    for (JsonVariantConst item : transitions) {
      if (!item.is<JsonObjectConst>() || !boundedString(item["transition_id"], 1, 96) ||
          !boundedString(item["step_id"], 1, 32)) {
        error = "invalid_brew_transition";
        return false;
      }
    }
    if (!brew["trace"].isNull()) {
      if (!brew["trace"].is<JsonObjectConst>()) { error = "invalid_trace_metadata"; return false; }
      JsonObjectConst trace = brew["trace"].as<JsonObjectConst>();
      if (trace["schema"].as<int>() != 1 || trace["sample_hz"].as<int>() != 10 ||
          !integerInRange(trace["sample_count"], 0, 4200) ||
          !integerInRange(trace["byte_length"], 16, 138616) || !boundedString(trace["crc32"], 8, 8) ||
          !trace["available"].is<bool>() || !trace["available"].as<bool>()) {
        error = "invalid_trace_metadata";
        return false;
      }
    }
  }
  return true;
}

bool UserDataStore::readRecipes(JsonDocument &output, String &error) const {
  return loadCollection(kRecipesPath, kMaxRecipesFile, output, error);
}

bool UserDataStore::readBrews(JsonDocument &output, size_t limit, String &error) const {
  JsonDocument stored;
  if (!loadCollection(kBrewsPath, kMaxBrewsFile, stored, error)) return false;
  const uint32_t revision = stored["revision"].as<uint32_t>();
  output.clear();
  output["v"] = 1;
  output["revision"] = revision;
  JsonArray destination = output["items"].to<JsonArray>();
  JsonArrayConst source = stored["items"].as<JsonArrayConst>();
  const size_t count = min(limit, source.size());
  for (size_t index = 0; index < count; ++index) destination.add(source[index]);
  return true;
}

bool UserDataStore::upsertRecipe(JsonObjectConst request, JsonDocument &output, int &status, String &error) {
  JsonDocument stored;
  if (!loadCollection(kRecipesPath, kMaxRecipesFile, stored, error)) {
    status = 500;
    return false;
  }
  const uint32_t revision = stored["revision"].as<uint32_t>();
  if (!validRevision(request, revision, status, error)) return false;
  if (!request["recipe"].is<JsonObjectConst>() || !validRecipe(request["recipe"].as<JsonObjectConst>(), error)) {
    status = 422;
    return false;
  }

  JsonArray items = stored["items"].as<JsonArray>();
  const char *id = request["recipe"]["id"].as<const char *>();
  bool replaced = false;
  for (JsonVariant item : items) {
    if (strcmp(item["id"] | "", id) == 0) {
      item.set(request["recipe"]);
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    if (items.size() >= kMaxRecipes) {
      status = 422;
      error = "recipe_limit_reached";
      return false;
    }
    items.add(request["recipe"]);
  }
  stored["revision"] = revision + 1;
  if (!writeCollection(kRecipesPath, stored, error)) {
    status = 507;
    return false;
  }
  status = replaced ? 200 : 201;
  copyCollectionEnvelope(output, revision + 1, items);
  return true;
}

bool UserDataStore::deleteRecipe(const String &id, uint32_t baseRevision, JsonDocument &output, int &status,
                                 String &error) {
  JsonDocument stored;
  if (!loadCollection(kRecipesPath, kMaxRecipesFile, stored, error)) {
    status = 500;
    return false;
  }
  const uint32_t revision = stored["revision"].as<uint32_t>();
  if (baseRevision != revision) {
    status = 409;
    error = "revision_conflict";
    return false;
  }
  JsonArray items = stored["items"].as<JsonArray>();
  bool removed = false;
  for (size_t index = 0; index < items.size(); ++index) {
    if (id == (items[index]["id"] | "")) {
      items.remove(index);
      removed = true;
      break;
    }
  }
  if (!removed) {
    status = 404;
    error = "recipe_not_found";
    return false;
  }
  stored["revision"] = revision + 1;
  if (!writeCollection(kRecipesPath, stored, error)) {
    status = 507;
    return false;
  }
  status = 200;
  copyCollectionEnvelope(output, revision + 1, items);
  return true;
}

bool UserDataStore::appendBrew(JsonObjectConst request, JsonDocument &output, int &status, String &error) {
  if (!request["brew"].is<JsonObjectConst>() || !validBrew(request["brew"].as<JsonObjectConst>(), error)) {
    status = 422;
    return false;
  }
  const String requestedId = request["brew"]["id"].as<const char *>();
  if (!request["brew"]["trace"].isNull() &&
      !LittleFS.exists(String(kTracesPath) + "/" + requestedId + ".pftr")) {
    status = 422;
    error = "trace_not_found";
    return false;
  }
  JsonDocument stored;
  if (!loadCollection(kBrewsPath, kMaxBrewsFile, stored, error)) {
    status = 500;
    return false;
  }
  JsonArray items = stored["items"].as<JsonArray>();
  const char *id = request["brew"]["id"].as<const char *>();
  for (JsonVariantConst item : items) {
    if (strcmp(item["id"] | "", id) == 0) {
      status = 200;
      copyCollectionEnvelope(output, stored["revision"].as<uint32_t>(), items);
      return true;
    }
  }
  items.add(request["brew"]);
  for (size_t index = items.size(); index > 1; --index) items[index - 1].set(items[index - 2]);
  items[0].set(request["brew"]);
  String removedId;
  if (items.size() > kMaxBrews) {
    removedId = items[items.size() - 1]["id"] | "";
    items.remove(items.size() - 1);
  }

  const uint32_t revision = stored["revision"].as<uint32_t>() + 1;
  stored["revision"] = revision;
  if (!writeCollection(kBrewsPath, stored, error)) {
    status = 507;
    return false;
  }
  if (!removedId.isEmpty()) removeTrace(removedId);
  status = 201;
  copyCollectionEnvelope(output, revision, items);
  return true;
}

bool UserDataStore::clearBrews(uint32_t baseRevision, JsonDocument &output, int &status, String &error) {
  JsonDocument stored;
  if (!loadCollection(kBrewsPath, kMaxBrewsFile, stored, error)) {
    status = 500;
    return false;
  }
  const uint32_t revision = stored["revision"].as<uint32_t>();
  if (baseRevision != revision) {
    status = 409;
    error = "revision_conflict";
    return false;
  }
  for (JsonVariantConst item : stored["items"].as<JsonArrayConst>()) removeTrace(item["id"] | "");
  makeCollection(stored);
  stored["revision"] = revision + 1;
  if (!writeCollection(kBrewsPath, stored, error)) {
    status = 507;
    return false;
  }
  status = 200;
  copyCollectionEnvelope(output, revision + 1, stored["items"].as<JsonArrayConst>());
  return true;
}

bool UserDataStore::removeTrace(const String &id) const {
  if (id.isEmpty() || id.length() > 64 || id.indexOf('/') >= 0 || id.indexOf("..") >= 0) return false;
  const String path = String(kTracesPath) + "/" + id + ".pftr";
  return !LittleFS.exists(path) || LittleFS.remove(path);
}

bool UserDataStore::storeTrace(const String &id, const char *temporaryPath, String &error) {
  if (id.isEmpty() || id.length() > 64 || id.indexOf('/') >= 0 || id.indexOf("..") >= 0) {
    error = "invalid_brew_id";
    return false;
  }
  File file = LittleFS.open(temporaryPath, "r");
  if (!file || file.size() < 16 || file.size() > 138616) {
    if (file) file.close();
    error = "invalid_trace_size";
    return false;
  }
  uint8_t header[16]{};
  if (file.read(header, sizeof(header)) != sizeof(header)) {
    file.close(); error = "invalid_trace_header"; return false;
  }
  auto read16 = [](const uint8_t *value) { return static_cast<uint16_t>(value[0] | (value[1] << 8)); };
  auto read32 = [](const uint8_t *value) { return static_cast<uint32_t>(value[0]) | (static_cast<uint32_t>(value[1]) << 8) | (static_cast<uint32_t>(value[2]) << 16) | (static_cast<uint32_t>(value[3]) << 24); };
  const uint32_t magic = read32(header);
  const uint16_t version = read16(header + 4);
  const uint16_t recordBytes = read16(header + 6);
  const uint32_t sampleCount = read32(header + 8);
  const uint32_t expectedCrc = read32(header + 12);
  if (magic != 0x52544650 || version != 1 || recordBytes != 33 || sampleCount > 4200 ||
      file.size() != 16 + sampleCount * recordBytes) {
    file.close(); error = "invalid_trace_header"; return false;
  }
  uint32_t crc = 0xffffffff;
  uint8_t buffer[256];
  while (file.available()) {
    const size_t count = file.read(buffer, sizeof(buffer));
    for (size_t index = 0; index < count; ++index) {
      crc ^= buffer[index];
      for (uint8_t bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  file.close();
  crc ^= 0xffffffff;
  if (crc != expectedCrc) { error = "trace_checksum_mismatch"; return false; }

  const String destination = String(kTracesPath) + "/" + id + ".pftr";
  if (LittleFS.exists(destination)) {
    File existing = LittleFS.open(destination, "r");
    uint8_t existingHeader[16]{};
    const bool sameTrace = existing && existing.size() == 16 + sampleCount * recordBytes &&
                           existing.read(existingHeader, sizeof(existingHeader)) == sizeof(existingHeader) &&
                           read32(existingHeader) == magic && read16(existingHeader + 4) == version &&
                           read16(existingHeader + 6) == recordBytes && read32(existingHeader + 8) == sampleCount &&
                           read32(existingHeader + 12) == expectedCrc;
    existing.close();
    if (sameTrace) { LittleFS.remove(temporaryPath); return true; }
    error = "trace_conflict";
    return false;
  }
  if (!LittleFS.rename(temporaryPath, destination)) { error = "storage_write_failed"; return false; }
  return true;
}

bool UserDataStore::pruneBrews(String &error) {
  JsonDocument stored;
  if (!loadCollection(kBrewsPath, kMaxBrewsFile, stored, error)) return false;
  JsonArray items = stored["items"].as<JsonArray>();
  bool changed = false;
  JsonDocument removed;
  JsonArray removedIds = removed.to<JsonArray>();
  while (items.size() > kMaxBrews) {
    removedIds.add(items[items.size() - 1]["id"] | "");
    items.remove(items.size() - 1);
    changed = true;
  }
  if (!changed) return true;
  stored["revision"] = stored["revision"].as<uint32_t>() + 1;
  if (!writeCollection(kBrewsPath, stored, error)) return false;
  for (JsonVariantConst id : removedIds) removeTrace(id.as<const char *>());
  return true;
}

bool UserDataStore::pruneOrphanTraces(String &error) const {
  JsonDocument stored;
  if (!loadCollection(kBrewsPath, kMaxBrewsFile, stored, error)) return false;
  File directory = LittleFS.open(kTracesPath);
  if (!directory || !directory.isDirectory()) { error = "storage_unavailable"; return false; }
  File entry = directory.openNextFile();
  while (entry) {
    const String path = entry.path();
    entry.close();
    bool referenced = false;
    for (JsonVariantConst item : stored["items"].as<JsonArrayConst>()) {
      if (path.endsWith(String("/") + String(item["id"] | "") + ".pftr")) { referenced = true; break; }
    }
    if (!referenced && path.endsWith(".pftr")) LittleFS.remove(path);
    entry = directory.openNextFile();
  }
  directory.close();
  return true;
}
