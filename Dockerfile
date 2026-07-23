# Stage 1: Build the static Go binary
FROM golang:alpine AS builder

WORKDIR /build

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the application source code
COPY . .

# Compile a static binary without CGO dependency
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o vm-dashboard .

# Stage 2: Create a minimal production image
FROM alpine:latest

# Install certificates and timezone data
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy the static binary from builder stage
COPY --from=builder /build/vm-dashboard /app/vm-dashboard

# Create the data directory for SQLite bind volume
RUN mkdir -p /app/data

# Expose port 8080
EXPOSE 8080

# Execute server using defaults pointing to the persistent mount
ENTRYPOINT ["/app/vm-dashboard", "-db", "/app/data/dashboard.db", "-port", "8080"]
