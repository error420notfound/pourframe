#include "led_controller.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace led {

bool Controller::handled(const char *id) const {
  if (id == nullptr || *id == '\0') return false;
  for (uint8_t index = 0; index < handledCount_; ++index) if (handledIds_[index] == id) return true;
  return false;
}

void Controller::remember(const char *id) {
  if (handled(id)) return;
  handledIds_[handledCursor_] = id;
  handledCursor_ = static_cast<uint8_t>((handledCursor_ + 1) % kHandledCapacity);
  handledCount_ = std::min<uint8_t>(kHandledCapacity, handledCount_ + 1);
}

CommandResult Controller::startCue(const char *cueId, uint8_t pulseCount, uint16_t intervalMs, uint32_t nowMs, Health health) {
  if (cueId == nullptr || *cueId == '\0' || pulseCount != 5 || intervalMs != 1000) return CommandResult::Invalid;
  if (handled(cueId)) return CommandResult::Duplicate;
  remember(cueId);
  cueId_ = cueId;
  pulsesCompleted_ = 0;
  if (health != Health::Healthy) {
    cueState_ = CueState::Unavailable;
    return CommandResult::Unavailable;
  }
  cueState_ = CueState::Active;
  cueStartedMs_ = nowMs;
  pulseCount_ = pulseCount;
  intervalMs_ = intervalMs;
  return CommandResult::Accepted;
}

CommandResult Controller::cancelCue(const char *cueId) {
  if (cueState_ != CueState::Active || cueId == nullptr || cueId_ != cueId) return handled(cueId) ? CommandResult::Duplicate : CommandResult::Invalid;
  cueState_ = CueState::Cancelled;
  return CommandResult::Accepted;
}

CommandResult Controller::activateStep(const char *transitionId, double baselineTotal, double stepGrams, double cumulativeGrams) {
  if (transitionId == nullptr || *transitionId == '\0' || !std::isfinite(baselineTotal) || !std::isfinite(stepGrams) || !std::isfinite(cumulativeGrams) || stepGrams <= 0.0 || cumulativeGrams <= 0.0) return CommandResult::Invalid;
  if (handled(transitionId)) return CommandResult::Duplicate;
  remember(transitionId);
  step_ = {true, baselineTotal, stepGrams, cumulativeGrams};
  return CommandResult::Accepted;
}

void Controller::clearStep() { step_ = {}; }

Color Controller::update(uint32_t nowMs, Health health, Color normal) {
  if (health == Health::Unavailable) {
    if (cueState_ == CueState::Active) cueState_ = CueState::HealthAborted;
    return {};
  }
  if (health == Health::Degraded) {
    if (cueState_ == CueState::Active) cueState_ = CueState::HealthAborted;
    const uint32_t phase = nowMs % 1000;
    normal.brightness = (phase < 120 || (phase >= 240 && phase < 360)) ? normal.brightness : 0;
    return normal;
  }
  if (cueState_ != CueState::Active) return normal;

  const uint32_t elapsed = nowMs - cueStartedMs_;
  const uint32_t duration = static_cast<uint32_t>(pulseCount_) * intervalMs_;
  if (elapsed >= duration) {
    pulsesCompleted_ = pulseCount_;
    cueState_ = CueState::Completed;
    return normal;
  }
  pulsesCompleted_ = static_cast<uint8_t>(elapsed / intervalMs_);
  const double phase = static_cast<double>(elapsed % intervalMs_) / intervalMs_;
  const double envelope = std::sin(phase * 3.14159265358979323846);
  const uint8_t brightness = static_cast<uint8_t>(std::lround(std::max(0.0, envelope) * 255.0));
  return {255, 255, 255, brightness, true};
}

CueStatus Controller::cueStatus() const { return {cueState_, cueId_.c_str(), pulsesCompleted_}; }

const char *cueStateName(CueState state) {
  if (state == CueState::Active) return "active";
  if (state == CueState::Completed) return "completed";
  if (state == CueState::Cancelled) return "cancelled";
  if (state == CueState::HealthAborted) return "health_aborted";
  if (state == CueState::Unavailable) return "unavailable";
  return "idle";
}

}  // namespace led
