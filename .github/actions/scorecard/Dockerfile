# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# Scorecard action v2.5.0, built with the eMudhra Go fix.
FROM golang:1.27.3@sha256:f20d83a83e18dbd2a4714b8ffd4b30b287b6243962dd75608e86abcc63ba4efc AS builder
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
ADD --checksum=sha256:3a13668a7e9ffaed3fb32347f1260ec57a9289e303ecc15a907e14ce3ad7627a https://api.github.com/repos/ossf/scorecard-action/tarball/fa7117db83c52d787ae5a89f350999701505d78e /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /src && rm /tmp/source.tar.gz
RUN go mod download
ARG TARGETOS
ARG TARGETARCH
RUN make build

FROM gcr.io/distroless/base@sha256:389cad21f73e4c37b94ffe5b13736d5a92bd5bd3c6c6b38c2be1c881e14ba2bd
COPY --from=builder /src/scorecard-action /
COPY --from=builder /src/policies/template.yml /policy.yml
ENTRYPOINT ["/scorecard-action"]
