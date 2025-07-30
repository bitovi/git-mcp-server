<div align="center">

# Bitovi Git MCP Server (Docker Edition)

**Run the @cyanheads/git-mcp-server in Docker with HTTP transport and enhanced logging!**

[![TypeScript](https://img.shields.io/badge/TypeScript-^5.8.3-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Model Context Protocol SDK](https://img.shields.io/badge/MCP%20SDK-^1.17.0-green?style=flat-square)](https://github.com/modelcontextprotocol/typescript-sdk)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=flat-square)](https://www.docker.com/)
[![Original Repository](https://img.shields.io/badge/Original-@cyanheads/git--mcp--server-green?style=flat-square)](https://github.com/cyanheads/git-mcp-server)

</div>

> **Note**: This is a Docker-optimized version of the excellent [@cyanheads/git-mcp-server](https://github.com/cyanheads/git-mcp-server). For complete documentation, features, and usage details, please refer to the [original README](https://github.com/cyanheads/git-mcp-server/blob/main/README.md).

This Docker edition provides an easy way to run the Git MCP Server in a containerized environment with HTTP transport and enhanced console logging for Docker Desktop.

## 🐳 Quick Start with Docker

### Prerequisites

- [Docker](https://www.docker.com/) installed and running
- Optional: [ngrok](https://ngrok.com/) for HTTPS tunneling

### Running the Container

1. **Build the Docker image:**
   ```bash
   docker build -t bitovi/git-mcp-server .
   ```

2. **Run in HTTP mode with console logging:**
   ```bash
   docker run -d --name git-mcp-server \
     -p 3010:3010 \
     -v /path/to/your/repos:/workspace \
     -e MCP_TRANSPORT_TYPE=http \
     -e MCP_HTTP_HOST=0.0.0.0 \
     -e MCP_HTTP_PORT=3010 \
     -e MCP_LOG_LEVEL=debug \
     -e MCP_FORCE_CONSOLE_LOGGING=true \
     bitovi/git-mcp-server
   ```

   **Using .env file (Recommended for multiple variables):**
   
   Copy the example environment file and customize it:
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

   Example `.env` file contents:
   ```bash
   # .env file
   MCP_TRANSPORT_TYPE=http
   MCP_HTTP_HOST=0.0.0.0
   MCP_HTTP_PORT=3010
   MCP_LOG_LEVEL=debug
   MCP_FORCE_CONSOLE_LOGGING=true
   GIT_TOKEN=ghp_your_personal_access_token_here
   GIT_USERNAME=your_github_username
   ```

   Then run Docker with the `--env-file` flag:
   ```bash
   docker run -d --name git-mcp-server \
     -p 3010:3010 \
     -v /path/to/your/repos:/workspace \
     --env-file .env \
     bitovi/git-mcp-server
   ```

   **Volume Options:**
   - **Local directory**: `-v /Users/yourname/git-repos:/workspace` (macOS/Linux)
   - **Windows**: `-v C:\git-repos:/workspace` 
   - **Docker volume**: `-v git-repos-volume:/workspace`

   **Volume Syntax Explained:**
   The `-v` flag uses the format `HOST_PATH:CONTAINER_PATH`:
   - **Left side** (`/path/to/your/repos`): Directory on your host machine
   - **Colon** (`:`): Separator between host and container paths  
   - **Right side** (`/workspace`): Directory inside the Docker container
   
   Example: `-v /Users/john/my-repos:/workspace` means:
   - Host directory: `/Users/john/my-repos` (on your computer)
   - Container directory: `/workspace` (inside Docker)
   - Files in both locations are synchronized

3. **Set the working directory via MCP:**
   - Use the `git_set_working_dir` tool to set `/workspace` as your base directory
   - All Git operations will then be relative to `/workspace`
   - Your cloned repositories will persist in the mounted volume

4. **Access the server:**
   - Local: `http://localhost:3010/mcp`
   - With ngrok: `ngrok http 3010` then use the HTTPS URL

5. **View logs in Docker Desktop:**
   - Open Docker Desktop
   - Navigate to Containers
   - Click on `git-mcp-server`
   - View the "Logs" tab for real-time HTTP request logging

### Working with Git Repositories

When you mount a volume, all Git operations can be performed within that persistent space:

```bash
# Example workflow using the MCP API:
# 1. Set working directory to the mounted volume
POST /mcp - git_set_working_dir tool with path="/workspace"

# 2. Clone a repository
POST /mcp - git_clone tool with url="https://github.com/user/repo.git"

# 3. The repo will be cloned to /workspace/repo (persisted on your host)
```

**Benefits of using volumes:**
- **Persistence**: Repositories survive container restarts
- **Host access**: Edit files directly on your host system
- **Performance**: Better I/O performance than container filesystem
- **Backup**: Easy to backup by copying the host directory

### Git Authentication

By default, the Docker container does **not** have access to your host's Git credentials. For private repositories or push operations, you'll need to provide authentication:

#### Option 1: Personal Access Token (Recommended for HTTPS)

Create a [GitHub Personal Access Token](https://github.com/settings/tokens) and configure Git credentials:

**Method A: Using GIT_TOKEN environment variable (Easiest)**
```bash
docker run -d --name git-mcp-server \
  -p 3010:3010 \
  -v /path/to/your/repos:/workspace \
  -e MCP_TRANSPORT_TYPE=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3010 \
  -e MCP_LOG_LEVEL=debug \
  -e MCP_FORCE_CONSOLE_LOGGING=true \
  -e GIT_TOKEN=ghp_your_token_here \
  -e GIT_USERNAME=your_github_username \
  bitovi/git-mcp-server
```

**Method A (Alternative): Using .env file**
Create a `.env` file with your credentials:
```bash
# .env file
MCP_TRANSPORT_TYPE=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3010
MCP_LOG_LEVEL=debug
MCP_FORCE_CONSOLE_LOGGING=true
GIT_TOKEN=ghp_your_personal_access_token_here
GIT_USERNAME=your_github_username
```

Then run with `--env-file`:
```bash
docker run -d --name git-mcp-server \
  -p 3010:3010 \
  -v /path/to/your/repos:/workspace \
  --env-file .env \
  bitovi/git-mcp-server
```

The container will automatically create a `.git-credentials` file and configure Git to use your token.

**Method B: Using Git credential store (Manual)**
```bash
# First, create a credential file on your host
echo "https://your_username:ghp_your_token_here@github.com" > ~/.git-credentials

# Then mount it into the container
docker run -d --name git-mcp-server \
  -p 3010:3010 \
  -v /path/to/your/repos:/workspace \
  -v ~/.git-credentials:/home/appuser/.git-credentials:ro \
  -e MCP_TRANSPORT_TYPE=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3010 \
  -e MCP_LOG_LEVEL=debug \
  -e MCP_FORCE_CONSOLE_LOGGING=true \
  bitovi/git-mcp-server
```

**Method C: Using repository URLs with embedded tokens**
For one-time operations, include the token directly in the repository URL:
```
https://your_username:ghp_your_token_here@github.com/user/repo.git
```

#### Option 2: SSH Keys (For SSH-based repositories)

Mount your SSH keys into the container:

```bash
docker run -d --name git-mcp-server \
  -p 3010:3010 \
  -v /path/to/your/repos:/workspace \
  -v ~/.ssh:/home/appuser/.ssh:ro \
  -e MCP_TRANSPORT_TYPE=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3010 \
  -e MCP_LOG_LEVEL=debug \
  -e MCP_FORCE_CONSOLE_LOGGING=true \
  bitovi/git-mcp-server
```

#### Option 3: Git Config + Credentials

Mount your Git configuration and credential files:

```bash
docker run -d --name git-mcp-server \
  -p 3010:3010 \
  -v /path/to/your/repos:/workspace \
  -v ~/.gitconfig:/home/appuser/.gitconfig:ro \
  -v ~/.git-credentials:/home/appuser/.git-credentials:ro \
  -e MCP_TRANSPORT_TYPE=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3010 \
  -e MCP_LOG_LEVEL=debug \
  -e MCP_FORCE_CONSOLE_LOGGING=true \
  bitovi/git-mcp-server
```

**Security Notes:**
- Personal Access Tokens are recommended for HTTPS repositories
- Mount credential files as read-only (`:ro`) when possible
- Never include credentials directly in the Docker image
- Consider using Docker secrets for production deployments
- **Important**: Add `.env` to your `.gitignore` file to avoid committing secrets to version control
- For production, consider using Docker secrets or external secret management systems

**Authentication Troubleshooting:**
- If authentication fails, verify your token has the necessary permissions (repo, read:org, etc.)
- For private repositories, ensure the token or SSH key has access to the specific repository
- Test authentication outside the container first: `git clone https://username:token@github.com/user/repo.git`

### Environment Variables

| Variable                    | Description                                           | Default     |
| --------------------------- | ----------------------------------------------------- | ----------- |
| `MCP_TRANSPORT_TYPE`        | Set to `http` for Docker deployment                  | `stdio`     |
| `MCP_HTTP_HOST`             | Host address (use `0.0.0.0` for Docker)             | `127.0.0.1` |
| `MCP_HTTP_PORT`             | Port for the HTTP server                             | `3010`      |
| `MCP_LOG_LEVEL`             | Logging level (`debug`, `info`, `warn`, `error`)     | `info`      |
| `MCP_FORCE_CONSOLE_LOGGING` | Force logs to stdout/stderr for Docker visibility    | `false`     |
| `GIT_TOKEN`                 | GitHub Personal Access Token for authentication      | `none`      |
| `GIT_USERNAME`              | GitHub username (defaults to "token" if not set)     | `token`     |

### Example HTTP Request

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    },
    "id": 1
  }'
```

---

## 📖 Original Documentation

For complete feature documentation, API reference, and detailed usage instructions, please visit the original repository:

**👉 [Complete Documentation - @cyanheads/git-mcp-server](https://github.com/cyanheads/git-mcp-server/blob/main/README.md)**

The original README includes:
- Complete list of available Git tools and commands
- Detailed configuration options
- Development setup instructions
- API documentation and examples
- Contributing guidelines

## � Docker Configuration Details

### Container Features

This Docker edition includes several enhancements for containerized deployment:

- **HTTP Transport**: Configured for HTTP-based MCP communication instead of stdio
- **Enhanced Logging**: Console logging forced to stdout/stderr for Docker Desktop visibility
- **Port Binding**: Exposed on port 3010 for external access
- **Multi-stage Build**: Optimized Docker image with minimal footprint
- **Security**: Runs as non-root user with proper permissions

### Troubleshooting

- **Container not accessible**: Ensure `MCP_HTTP_HOST=0.0.0.0` (not `127.0.0.1`)
- **No logs in Docker Desktop**: Verify `MCP_FORCE_CONSOLE_LOGGING=true` is set
- **Port conflicts**: Change the external port mapping (`-p 3011:3010`)
- **HTTPS required**: Use ngrok or configure reverse proxy with SSL
- **Volume permissions**: Ensure the host directory has proper read/write permissions
- **Git operations fail**: Use `git_set_working_dir` to set `/workspace` before Git operations
- **Files not persisting**: Verify the volume mount path matches the working directory set via MCP

### Development

For local development with the original stdio transport:

```bash
npm install
npm run build
npm run start:server
```

Refer to the [original repository](https://github.com/cyanheads/git-mcp-server) for complete development setup instructions.

## 📜 License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

Based on the original work by [@cyanheads/git-mcp-server](https://github.com/cyanheads/git-mcp-server).
