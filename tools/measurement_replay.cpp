#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "measurement_pipeline.h"

namespace {
bool parseLine(const std::string &line, measurement::RawSamplePair &sample) {
  std::stringstream stream(line);
  std::string field;
  std::vector<std::string> fields;
  while (std::getline(stream, field, ',')) fields.push_back(field);
  if (fields.size() < 8) return false;
  try {
    sample.pairTimestampUs = std::stoull(fields[0]);
    sample.sequence = static_cast<uint32_t>(std::stoul(fields[1]));
    sample.upperRaw = std::stoi(fields[2]);
    sample.lowerRaw = std::stoi(fields[3]);
    sample.upperValid = std::stoi(fields[4]) != 0;
    sample.lowerValid = std::stoi(fields[5]) != 0;
    sample.pairSkewUs = static_cast<uint32_t>(std::stoul(fields[6]));
    sample.upperReadTimestampUs = sample.pairTimestampUs - sample.pairSkewUs / 2;
    sample.lowerReadTimestampUs = sample.pairTimestampUs + sample.pairSkewUs / 2;
    return true;
  } catch (...) {
    return false;
  }
}
}  // namespace

int main(int argc, char **argv) {
  if (argc != 7) {
    std::cerr << "usage: measurement-replay input.csv output.csv upper_zero upper_factor lower_zero lower_factor\n";
    return EXIT_FAILURE;
  }
  std::ifstream input(argv[1]);
  std::ofstream output(argv[2]);
  if (!input || !output) {
    std::cerr << "could not open input or output\n";
    return EXIT_FAILURE;
  }
  measurement::DualScaleCalibration calibration{};
  calibration.zeroOffsetCounts[0] = std::stod(argv[3]);
  calibration.countsPerGram[0] = std::stod(argv[4]);
  calibration.zeroOffsetCounts[1] = std::stod(argv[5]);
  calibration.countsPerGram[1] = std::stod(argv[6]);
  calibration.channelCalibrated[0] = measurement::MeasurementPipeline::validScaleFactor(calibration.countsPerGram[0]);
  calibration.channelCalibrated[1] = measurement::MeasurementPipeline::validScaleFactor(calibration.countsPerGram[1]);
  measurement::MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration);

  output << "timestamp_us,sequence,upper_raw,lower_raw,upper_median,lower_median,upper_calibrated,lower_calibrated,"
            "upper_filtered,lower_filtered,total_filtered,upper_slope_g_s,lower_slope_g_s,total_slope_g_s,"
            "upper_range_g,lower_range_g,total_range_g,state,candidate_state,alpha,residual_g_s,confidence,"
            "sample_rate_hz,pair_skew_us,pair_valid\n";
  std::string line;
  std::getline(input, line);  // documented input header
  uint64_t previousTimestamp = 0;
  while (std::getline(input, line)) {
    measurement::RawSamplePair sample{};
    if (!parseLine(line, sample)) continue;
    const double rate = previousTimestamp == 0 || sample.pairTimestampUs <= previousTimestamp
                            ? measurement::config::kNominalSampleRateHz
                            : 1000000.0 / static_cast<double>(sample.pairTimestampUs - previousTimestamp);
    previousTimestamp = sample.pairTimestampUs;
    if (!pipeline.process(sample, rate)) continue;
    const auto &s = pipeline.snapshot();
    output << s.timestampUs << ',' << s.sequence << ',' << s.upperRaw << ',' << s.lowerRaw << ',' << s.upperMedianRaw
           << ',' << s.lowerMedianRaw << ',' << std::setprecision(10) << s.upperCalibrated << ',' << s.lowerCalibrated
           << ',' << s.upperFiltered << ',' << s.lowerFiltered << ',' << s.totalFiltered << ',' << s.upperSlopeGps << ','
           << s.lowerSlopeGps << ',' << s.totalSlopeGps << ',' << s.upperRangeGrams << ',' << s.lowerRangeGrams << ','
           << s.totalRangeGrams << ',' << measurement::stateName(s.state) << ',' << measurement::stateName(s.candidateState)
           << ',' << s.selectedAlpha << ',' << s.transferResidualGps << ',' << s.confidence << ',' << s.observedSampleRateHz
           << ',' << s.pairSkewUs << ',' << (s.pairValid ? 1 : 0) << '\n';
  }
}
