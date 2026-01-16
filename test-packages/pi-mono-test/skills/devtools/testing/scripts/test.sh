#!/usr/bin/env bash
# Test execution script for Pi-Mono testing skill

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TEST_TIMEOUT="${TEST_TIMEOUT:-5000}"
TEST_PARALLEL="${TEST_PARALLEL:-true}"
TEST_VERBOSE="${TEST_VERBOSE:-false}"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

run_all_tests() {
    log_info "Running all tests..."
    
    if [ "$TEST_PARALLEL" = "true" ]; then
        bun test --timeout "$TEST_TIMEOUT"
    else
        bun test --timeout "$TEST_TIMEOUT" --no-parallel
    fi
}

run_unit_tests() {
    local test_file="$1"
    log_info "Running unit tests: $test_file"
    bun test "$test_file" --timeout "$TEST_TIMEOUT"
}

run_with_coverage() {
    log_info "Running tests with coverage..."
    bun test --coverage --timeout "$TEST_TIMEOUT"
}

show_usage() {
    cat << EOF
Usage: $0 [command] [options]

Commands:
  all              Run all tests
  unit <file>      Run specific test file
  coverage         Run tests with coverage
  help             Show this help message

Environment Variables:
  TEST_TIMEOUT     Test timeout in milliseconds (default: 5000)
  TEST_PARALLEL    Run tests in parallel (default: true)
  TEST_VERBOSE     Show detailed output (default: false)

Examples:
  $0 all
  $0 unit src/core/save.test.ts
  $0 coverage
EOF
}

# Main
main() {
    local command="${1:-help}"
    
    case "$command" in
        all)
            run_all_tests
            ;;
        unit)
            if [ -z "${2:-}" ]; then
                log_error "Test file required for 'unit' command"
                show_usage
                exit 1
            fi
            run_unit_tests "$2"
            ;;
        coverage)
            run_with_coverage
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            log_error "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"
