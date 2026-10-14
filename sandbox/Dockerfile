# Supply an official Node 24 Debian slim image pinned by digest when building.
# Example: docker build --build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest> -t dependencyguard-probe:local sandbox
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/dependencyguard
COPY --chown=0:0 runner.mjs probe.cjs ./
USER 10001:10001
ENTRYPOINT ["node", "/opt/dependencyguard/runner.mjs"]
