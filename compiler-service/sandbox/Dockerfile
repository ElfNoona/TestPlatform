# Dart sandbox image for code execution
# Minimal, non-root, no network access enforced at container-creation time

FROM dart:3.4-sdk AS base

# Create a non-root user for code execution
RUN groupadd -r sandbox && useradd -r -g sandbox sandbox

# Working directory — read-only at runtime (bind-mounted from host)
WORKDIR /workspace

# Pre-warm Dart SDK snapshot cache to reduce per-execution cold start
# TODO: if you need Flutter (for widget tests), switch to a Flutter base image
RUN dart --version

USER sandbox

# The actual command is passed dynamically by the worker (Dockerode Cmd field)
# Default entrypoint is overridden — this CMD is just a fallback placeholder
CMD ["dart", "run", "/workspace/solution.dart"]
