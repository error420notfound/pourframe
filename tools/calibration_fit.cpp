#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {
struct Point { double grams; double raw; };

bool fit(const std::vector<Point> &points, double &offset, double &factor, double &rms, double &maximum) {
  if (points.size() < 2) return false;
  double sumX = 0.0, sumY = 0.0, sumXX = 0.0, sumXY = 0.0;
  for (const auto &point : points) {
    sumX += point.grams;
    sumY += point.raw;
    sumXX += point.grams * point.grams;
    sumXY += point.grams * point.raw;
  }
  const double n = points.size();
  const double denominator = n * sumXX - sumX * sumX;
  if (std::fabs(denominator) < 1e-12) return false;
  factor = (n * sumXY - sumX * sumY) / denominator;
  offset = (sumY - factor * sumX) / n;
  double squared = 0.0;
  maximum = 0.0;
  for (const auto &point : points) {
    const double residualGrams = (point.raw - offset) / factor - point.grams;
    squared += residualGrams * residualGrams;
    maximum = std::max(maximum, std::fabs(residualGrams));
  }
  rms = std::sqrt(squared / n);
  return std::isfinite(factor) && std::fabs(factor) > 0.0001;
}
}  // namespace

int main(int argc, char **argv) {
  if (argc != 2) {
    std::cerr << "usage: calibration-fit known-weights.csv\n"
                 "columns: channel,known_grams,mean_raw\n";
    return EXIT_FAILURE;
  }
  std::ifstream input(argv[1]);
  if (!input) return EXIT_FAILURE;
  std::vector<Point> upper;
  std::vector<Point> lower;
  std::string line;
  std::getline(input, line);
  while (std::getline(input, line)) {
    std::stringstream stream(line);
    std::string channel, grams, raw;
    if (!std::getline(stream, channel, ',') || !std::getline(stream, grams, ',') || !std::getline(stream, raw, ',')) continue;
    try {
      (channel == "upper" ? upper : lower).push_back({std::stod(grams), std::stod(raw)});
    } catch (...) {}
  }
  std::cout << "channel,zero_offset_counts,counts_per_gram,rms_residual_g,max_residual_g\n";
  for (const auto &entry : {std::make_pair("upper", upper), std::make_pair("lower", lower)}) {
    double offset = 0.0, factor = 0.0, rms = 0.0, maximum = 0.0;
    if (!fit(entry.second, offset, factor, rms, maximum)) {
      std::cerr << entry.first << ": need at least two distinct finite known-weight points\n";
      continue;
    }
    std::cout << entry.first << ',' << std::setprecision(12) << offset << ',' << factor << ',' << rms << ',' << maximum << '\n';
  }
}
