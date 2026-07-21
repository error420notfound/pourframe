#pragma once

#include <cstdint>
#include <string>

namespace led {

enum class Health : uint8_t { Healthy, Degraded, Unavailable };
enum class CueState : uint8_t { Idle, Active, Completed, Cancelled, HealthAborted, Unavailable };
enum class CommandResult : uint8_t { Accepted, Duplicate, Unavailable, Invalid };

struct Color {
  Color(uint8_t redValue = 0, uint8_t greenValue = 0, uint8_t blueValue = 0, uint8_t brightnessValue = 255,
        bool cueValue = false)
      : red(redValue), green(greenValue), blue(blueValue), brightness(brightnessValue), cue(cueValue) {}
  uint8_t red = 0;
  uint8_t green = 0;
  uint8_t blue = 0;
  uint8_t brightness = 255;
  bool cue = false;
};

struct CueStatus {
  CueStatus(CueState stateValue = CueState::Idle, const char *idValue = "", uint8_t pulsesValue = 0)
      : state(stateValue), id(idValue), pulsesCompleted(pulsesValue) {}
  CueState state = CueState::Idle;
  const char *id = "";
  uint8_t pulsesCompleted = 0;
};

struct StepTarget {
  StepTarget(bool activeValue = false, double baselineValue = 0.0, double stepValue = 0.0,
             double cumulativeValue = 0.0)
      : active(activeValue), baselineTotal(baselineValue), stepGrams(stepValue), cumulativeGrams(cumulativeValue) {}
  bool active = false;
  double baselineTotal = 0.0;
  double stepGrams = 0.0;
  double cumulativeGrams = 0.0;
};

class Controller {
 public:
  CommandResult startCue(const char *cueId, uint8_t pulseCount, uint16_t intervalMs, uint32_t nowMs, Health health);
  CommandResult cancelCue(const char *cueId);
  CommandResult activateStep(const char *transitionId, double baselineTotal, double stepGrams, double cumulativeGrams);
  void clearStep();
  Color update(uint32_t nowMs, Health health, Color normal);
  CueStatus cueStatus() const;
  const StepTarget &stepTarget() const { return step_; }

 private:
  bool handled(const char *id) const;
  void remember(const char *id);

  static constexpr uint8_t kHandledCapacity = 16;
  std::string handledIds_[kHandledCapacity];
  uint8_t handledCount_ = 0;
  uint8_t handledCursor_ = 0;
  std::string cueId_;
  CueState cueState_ = CueState::Idle;
  uint32_t cueStartedMs_ = 0;
  uint8_t pulseCount_ = 0;
  uint16_t intervalMs_ = 1000;
  uint8_t pulsesCompleted_ = 0;
  StepTarget step_{};
};

const char *cueStateName(CueState state);

}  // namespace led
