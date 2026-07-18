#include "scale_channel.h"

ScaleChannel::ScaleChannel(ScaleId id, uint8_t doutPin, uint8_t clockPin)
    : id_(id), doutPin_(doutPin), clockPin_(clockPin) {}

void ScaleChannel::begin() { adc_.begin(doutPin_, clockPin_, 128); }

bool ScaleChannel::isReady() { return adc_.is_ready(); }

int32_t ScaleChannel::readRaw() { return static_cast<int32_t>(adc_.read()); }

ScaleId ScaleChannel::id() const { return id_; }

void ScaleChannel::powerDown() { adc_.power_down(); }

void ScaleChannel::powerUp() { adc_.power_up(); }
