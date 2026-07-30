#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

class UserDataStore {
 public:
  static constexpr size_t kMaxRecipes = 24;
  static constexpr size_t kMaxCoffeeBags = 24;
  static constexpr size_t kMaxBrews = 5;
  static constexpr size_t kMaxRecipePayload = 8192;
  static constexpr size_t kMaxCoffeeBagPayload = 12288;
  static constexpr size_t kMaxBrewPayload = 8192;
  static constexpr size_t kMaxBrewCompletionPayload = 24576;

  bool begin();
  bool readRecipes(JsonDocument &output, String &error) const;
  bool readCoffeeBags(JsonDocument &output, String &error) const;
  bool readBrews(JsonDocument &output, size_t limit, String &error) const;
  bool upsertRecipe(JsonObjectConst request, JsonDocument &output, int &status, String &error);
  bool deleteRecipe(const String &id, uint32_t baseRevision, JsonDocument &output, int &status, String &error);
  bool upsertCoffeeBag(JsonObjectConst request, JsonDocument &output, int &status, String &error);
  bool deleteCoffeeBag(const String &id, uint32_t baseRevision, JsonDocument &output, int &status, String &error);
  bool appendBrew(JsonObjectConst request, JsonDocument &output, int &status, String &error);
  bool completeBrew(JsonObjectConst request, JsonDocument &output, int &status, String &error);
  bool clearBrews(uint32_t baseRevision, JsonDocument &output, int &status, String &error);
  bool storeTrace(const String &id, const char *temporaryPath, String &error);
  bool removeTrace(const String &id) const;

 private:
  static constexpr const char *kRecipesPath = "/user/recipes.json";
  static constexpr const char *kCoffeeBagsPath = "/user/coffee-bags.json";
  static constexpr const char *kBrewsPath = "/user/brews.json";
  static constexpr const char *kCompletionJournalPath = "/user/brew-completion.pending.json";
  static constexpr const char *kTracesPath = "/user/traces";
  static constexpr size_t kMaxRecipesFile = 49152;
  static constexpr size_t kMaxCoffeeBagsFile = 65536;
  static constexpr size_t kMaxBrewsFile = 65536;
  static constexpr size_t kMaxCompletionJournalFile = 147456;

  bool loadCollection(const char *path, size_t maxBytes, JsonDocument &document, String &error) const;
  bool writeCollection(const char *path, const JsonDocument &document, String &error) const;
  bool validRecipe(JsonObjectConst recipe, String &error) const;
  bool validCoffeeBag(JsonObjectConst coffeeBag, String &error) const;
  bool validCoffeeBagSnapshot(JsonObjectConst coffeeBag, String &error) const;
  bool validBrew(JsonObjectConst brew, String &error) const;
  bool writeCompletionJournal(const JsonDocument &document, String &error) const;
  bool recoverPendingCompletion(String &error) const;
  void makeCollection(JsonDocument &document) const;
  bool pruneBrews(String &error);
  bool pruneOrphanTraces(String &error) const;
};
