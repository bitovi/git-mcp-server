# ---- Base Node ----
# Use a specific Node.js version known to work, Alpine for smaller size
FROM node:23-alpine AS base
WORKDIR /usr/src/app
ENV NODE_ENV=production

# Install git and other essential tools
RUN apk add --no-cache git

# ---- Dependencies ----
# Install dependencies first to leverage Docker cache
FROM base AS deps
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
# Use npm ci for deterministic installs based on lock file
# Install only production dependencies in this stage for the final image
RUN npm ci --only=production

# ---- Builder ----
# Build the application
FROM base AS builder
WORKDIR /usr/src/app
# Copy dependency manifests and install *all* dependencies (including dev)
COPY package.json package-lock.json* ./
RUN npm ci
# Copy the rest of the source code
COPY . .
# Build the TypeScript project
RUN npm run build
# Make the built file executable
RUN chmod +x dist/index.js

# ---- Runner ----
# Final stage with only production dependencies and built code
FROM base AS runner
WORKDIR /usr/src/app
# Copy production node_modules from the 'deps' stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
# Copy built application from the 'builder' stage
COPY --from=builder /usr/src/app/dist ./dist
# Copy package.json (needed for potential runtime info, like version)
COPY package.json .
# Copy the entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create a non-root user and switch to it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Change ownership of the app directory to the non-root user
RUN chown -R appuser:appgroup /usr/src/app
USER appuser

# Set default environment variables
ENV MCP_TRANSPORT_TYPE=stdio
ENV MCP_LOG_LEVEL=info
ENV MCP_FORCE_CONSOLE_LOGGING=true

# Expose port for HTTP transport (if used)
EXPOSE 3010

# Set the entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Command to run the application
CMD ["node", "dist/index.js"]
